import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertFinding } from "./deliver";
import {
  buildQueuedSlackPayload,
  drainSlackAlertDeliveries,
  toSafeSlackDeliveryPayload,
  type SlackAlertDeliveryStore,
} from "./slack-alert-queue";

const webhookUrl = "https://hooks.slack.com/services/T_TEST/B_TEST/S_TEST";
const webhookHash = "36b243d5b0e2304cbdf6f5bf362061b4f0e5cdc842c7f407af9253d0207cce52";

const finding: AlertFinding = {
  organisationId: "org1",
  sourceId: "src1",
  checkId: "github.branch_protection",
  controlRef: "A.8.32",
  subjectType: "github_repo",
  subjectId: "acme/isms",
  severity: "critical",
  title: "Production branch is unprotected",
  detail: "No protection rule on main.",
};

type ClaimedSlackAlertDelivery = NonNullable<Awaited<ReturnType<SlackAlertDeliveryStore["claim"]>>>;

function claimed(overrides: Partial<ClaimedSlackAlertDelivery> = {}): ClaimedSlackAlertDelivery {
  return {
    deliveryId: "10000000-0000-4000-8000-000000000001",
    organisationId: "org1",
    channelId: "10000000-0000-4000-8000-000000000003",
    lockToken: "10000000-0000-4000-8000-000000000002",
    attemptCount: 1,
    payload: toSafeSlackDeliveryPayload(finding),
    ...overrides,
  };
}

function store(delivery: ClaimedSlackAlertDelivery | null = claimed()): SlackAlertDeliveryStore {
  return {
    enqueueAndClaim: vi.fn(),
    claim: vi.fn().mockResolvedValueOnce(delivery),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
  };
}

describe("Slack alert payload safety", () => {
  it("bounds and removes control characters from persisted finding fields", () => {
    const safe = toSafeSlackDeliveryPayload({
      ...finding,
      title: "  @here\n<@U123>\u0000 branch  ",
      detail: "x".repeat(700),
    });

    expect(safe.title).toBe("@here <@U123> branch");
    expect(safe.detail).toHaveLength(500);
    expect(JSON.stringify(safe)).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it("uses bounded plain_text blocks so finding copy cannot inject Slack formatting", () => {
    const payload = buildQueuedSlackPayload({
      ...toSafeSlackDeliveryPayload(finding),
      title: "<@channel> *urgent*",
      detail: "`@everyone` needs review",
    });
    const textObjects = payload.blocks.flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const value = block as { text?: unknown; fields?: unknown };
      const objects = [value.text, ...(Array.isArray(value.fields) ? value.fields : [])];
      return objects.filter((item): item is { type: string; text: string } => Boolean(item) && typeof item === "object");
    });

    expect(payload.text).not.toContain("<@channel>");
    expect(textObjects.every((item) => item.type === "plain_text")).toBe(true);
    expect(textObjects.map((item) => item.text).join(" ")).toContain("<@channel> *urgent*");
    expect(textObjects.map((item) => item.text).join(" ")).not.toContain("mrkdwn");
  });
});

describe("drainSlackAlertDeliveries", () => {
  beforeEach(() => vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", webhookHash));
  afterEach(() => vi.unstubAllEnvs());

  it("approves the resolved destination immediately before outbound delivery", async () => {
    const deliveryStore = store();
    const resolveWebhookUrl = vi.fn().mockResolvedValue(webhookUrl);
    const postSlack = vi.fn().mockResolvedValue(undefined);

    await expect(drainSlackAlertDeliveries({
      store: deliveryStore,
      workerId: "integration-worker",
      resolveWebhookUrl,
      postSlack,
    })).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });

    expect(resolveWebhookUrl).toHaveBeenCalledWith("org1", "10000000-0000-4000-8000-000000000003", expect.any(AbortSignal));
    expect(postSlack).toHaveBeenCalledWith(webhookUrl, expect.any(Object), expect.any(AbortSignal));
    expect(deliveryStore.complete).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    );
  });

  it("fails closed and never posts an unapproved destination", async () => {
    const deliveryStore = store();
    const postSlack = vi.fn().mockResolvedValue(undefined);

    await expect(drainSlackAlertDeliveries({
      store: deliveryStore,
      workerId: "integration-worker",
      resolveWebhookUrl: vi.fn().mockResolvedValue("https://hooks.slack.com/services/T_OTHER/B_OTHER/S_OTHER"),
      postSlack,
    })).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1 });

    expect(postSlack).not.toHaveBeenCalled();
    expect(deliveryStore.fail).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    );
  });

  it("checks the abort signal before claiming work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("deadline"));
    const deliveryStore = store();

    await expect(drainSlackAlertDeliveries({
      store: deliveryStore,
      workerId: "integration-worker",
      signal: controller.signal,
      resolveWebhookUrl: vi.fn(),
      postSlack: vi.fn(),
    })).rejects.toThrow("deadline");
    expect(deliveryStore.claim).not.toHaveBeenCalled();
  });

  it("does not count a stale lease as delivered", async () => {
    const deliveryStore = store();
    vi.mocked(deliveryStore.complete).mockResolvedValue(false);

    await expect(drainSlackAlertDeliveries({
      store: deliveryStore,
      workerId: "integration-worker",
      resolveWebhookUrl: vi.fn().mockResolvedValue(webhookUrl),
      postSlack: vi.fn().mockResolvedValue(undefined),
    })).resolves.toEqual({ claimed: 1, delivered: 0, failed: 0 });
  });

  it("records a failed transport against the exact lease", async () => {
    const deliveryStore = store();
    const postSlack = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    await expect(drainSlackAlertDeliveries({
      store: deliveryStore,
      workerId: "integration-worker",
      resolveWebhookUrl: vi.fn().mockResolvedValue(webhookUrl),
      postSlack,
    })).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1 });

    expect(deliveryStore.complete).not.toHaveBeenCalled();
    expect(deliveryStore.fail).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    );
  });

  it("does not finalize a lease when cancellation happens during outbound delivery", async () => {
    const controller = new AbortController();
    const deliveryStore = store();
    const postSlack = vi.fn(async () => controller.abort(new Error("cancelled")));

    await expect(drainSlackAlertDeliveries({
      store: deliveryStore,
      workerId: "integration-worker",
      signal: controller.signal,
      resolveWebhookUrl: vi.fn().mockResolvedValue(webhookUrl),
      postSlack,
    })).rejects.toThrow("cancelled");

    expect(deliveryStore.complete).not.toHaveBeenCalled();
    expect(deliveryStore.fail).not.toHaveBeenCalled();
  });

  it("checks cancellation after resolving a destination and before posting", async () => {
    const controller = new AbortController();
    const deliveryStore = store();
    const postSlack = vi.fn();
    const resolveWebhookUrl = vi.fn(async () => {
      controller.abort(new Error("cancelled before post"));
      return webhookUrl;
    });

    await expect(drainSlackAlertDeliveries({
      store: deliveryStore,
      workerId: "integration-worker",
      signal: controller.signal,
      resolveWebhookUrl,
      postSlack,
    })).rejects.toThrow("cancelled before post");

    expect(postSlack).not.toHaveBeenCalled();
    expect(deliveryStore.complete).not.toHaveBeenCalled();
    expect(deliveryStore.fail).not.toHaveBeenCalled();
  });

  it.each([0, 26, 1.5])("rejects invalid batch size %s", async (batchSize) => {
    await expect(drainSlackAlertDeliveries({
      store: store(null),
      workerId: "integration-worker",
      batchSize,
      resolveWebhookUrl: vi.fn(),
      postSlack: vi.fn(),
    })).rejects.toThrow("Alert delivery worker configuration is invalid");
  });
});
