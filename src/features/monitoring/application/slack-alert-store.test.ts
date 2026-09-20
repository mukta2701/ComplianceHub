// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { encryptSecret } from "@/lib/security/secrets";
import {
  createSupabaseGitHubConnectionSlackAlertDeliveryStore,
  drainSupabaseGitHubConnectionSlackAlertDeliveries,
  enqueueGitHubConnectionAlertDelivery,
} from "./slack-alert-store";

const INPUT = {
  organisationId: "33333333-3333-4333-8333-333333333333",
  channelId: "55555555-5555-4555-8555-555555555555",
  installationId: "22222222-2222-4222-8222-222222222222",
  kind: "incident" as const,
  diagnostic: "permission_mismatch" as const,
  payload: {
    type: "connection_health" as const,
    severity: "high" as const,
    title: "GitHub connection needs attention",
    controlRef: "GitHub connection",
    subjectId: "22222222-2222-4222-8222-222222222222",
    detail: "Access needs an Owner decision.",
  },
};

describe("enqueueGitHubConnectionAlertDelivery", () => {
  it("queues through the connection alert RPC and returns whether it was newly queued", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: true,
      error: null,
    });
    const queued = await enqueueGitHubConnectionAlertDelivery({ rpc } as never, INPUT);
    expect(rpc).toHaveBeenCalledWith(
      "queue_github_connection_alert_delivery",
      expect.objectContaining({
        target_organisation_id: INPUT.organisationId,
        target_channel_id: INPUT.channelId,
        target_installation_id: INPUT.installationId,
        target_kind: "incident",
        target_diagnostic_code: "permission_mismatch",
      }),
    );
    expect(queued).toBe(true);
  });

  it("returns false when an identical alert is already queued", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    await expect(enqueueGitHubConnectionAlertDelivery({ rpc } as never, INPUT)).resolves.toBe(false);
  });

  it("fails closed on database errors without surfacing internals", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "db-internal" } });
    await expect(enqueueGitHubConnectionAlertDelivery({ rpc } as never, INPUT)).rejects.toThrow(
      "Connection alert delivery queue failed",
    );
  });

  it("rejects non-boolean queue responses without surfacing database details", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ delivery_id: "not-a-boolean" }], error: null });
    try {
      await enqueueGitHubConnectionAlertDelivery({ rpc } as never, INPUT);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toBe("Error: Connection alert delivery queue failed");
      expect(String(error)).not.toContain("not-a-boolean");
    }
  });
});

const DELIVERY = {
  delivery_id: "66666666-6666-4666-8666-666666666666",
  lock_token: "77777777-7777-4777-8777-777777777777",
  organisation_id: INPUT.organisationId,
  channel_id: INPUT.channelId,
  attempt_count: 1,
  safe_payload: INPUT.payload,
};

describe("connection-only Slack delivery store", () => {
  it("claims only connection deliveries and reuses complete and fail RPCs", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [DELIVERY], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const store = createSupabaseGitHubConnectionSlackAlertDeliveryStore({ rpc } as never);
    await expect(store.claim("github-connection:test-worker")).resolves.toEqual({
      deliveryId: DELIVERY.delivery_id,
      lockToken: DELIVERY.lock_token,
      organisationId: DELIVERY.organisation_id,
      channelId: DELIVERY.channel_id,
      attemptCount: DELIVERY.attempt_count,
      payload: DELIVERY.safe_payload,
    });
    expect(rpc).toHaveBeenCalledWith("claim_github_connection_alert_delivery", {
      worker_id: "github-connection:test-worker",
    });
    expect(rpc).not.toHaveBeenCalledWith("claim_alert_delivery", expect.anything());
    await expect(store.complete(DELIVERY.delivery_id, DELIVERY.lock_token)).resolves.toBe(true);
    await expect(store.fail(DELIVERY.delivery_id, DELIVERY.lock_token)).resolves.toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_alert_delivery", {
      target_delivery_id: DELIVERY.delivery_id,
      claimed_lock_token: DELIVERY.lock_token,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "fail_alert_delivery", {
      target_delivery_id: DELIVERY.delivery_id,
      claimed_lock_token: DELIVERY.lock_token,
    });
  });
});

describe("connection-only Slack delivery drain", () => {
  const webhookUrl = "https://hooks.slack.com/services/T000/B000/fixture";

  function channelClient(row: unknown, finaliseResult: boolean = true) {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [DELIVERY], error: null })
      .mockResolvedValueOnce({ data: finaliseResult, error: null })
      .mockResolvedValue({ data: [], error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle,
    };
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) });
    return { rpc, from };
  }

  function approvedConfig() {
    const encryptedWebhook = encryptSecret(webhookUrl);
    const webhookSha256 = createHash("sha256").update(webhookUrl, "utf8").digest("hex");
    return { webhookUrl: encryptedWebhook, webhookSha256 };
  }

  it("delivers one approved encrypted destination", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", createHash("sha256").update(webhookUrl, "utf8").digest("hex"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    const supabase = channelClient({ type: "slack", enabled: true, revoked_at: null, config: approvedConfig() });
    await expect(drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      AbortSignal.timeout(5_000),
    )).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });
    vi.unstubAllGlobals();
  });

  it.each([
    ["unapproved destination", () => ({ type: "slack", enabled: true, revoked_at: null, config: { ...approvedConfig(), webhookSha256: "0".repeat(64) } })],
    ["decrypt failure", () => ({ type: "slack", enabled: true, revoked_at: null, config: { ...approvedConfig(), webhookUrl: "v1:corrupt" } })],
  ])("records a safe failure for %s", async (_label, makeRow) => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", createHash("sha256").update(webhookUrl, "utf8").digest("hex"));
    const supabase = channelClient(makeRow());
    await expect(drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      AbortSignal.timeout(5_000),
    )).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1 });
  });

  it("records a safe failure for a non-2xx Slack response", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", createHash("sha256").update(webhookUrl, "utf8").digest("hex"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    const supabase = channelClient({ type: "slack", enabled: true, revoked_at: null, config: approvedConfig() });
    await expect(drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      AbortSignal.timeout(5_000),
    )).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1 });
    vi.unstubAllGlobals();
  });

  it("does not count a stale lease that cannot be failed", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", createHash("sha256").update(webhookUrl, "utf8").digest("hex"));
    const supabase = channelClient({ type: "slack", enabled: true, revoked_at: null, config: { ...approvedConfig(), webhookSha256: "0".repeat(64) } }, false);
    await expect(drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      AbortSignal.timeout(5_000),
    )).resolves.toEqual({ claimed: 1, delivered: 0, failed: 0 });
  });

  it("stops before claiming when the shared signal is already aborted", async () => {
    const supabase = channelClient(null);
    const controller = new AbortController();
    controller.abort(new Error("deadline"));
    await expect(drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      controller.signal,
    )).rejects.toThrow("deadline");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
