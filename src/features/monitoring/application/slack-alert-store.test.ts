// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";

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
  lock_token: randomUUID(),
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

  type QueryResult = { data: unknown; error: unknown };
  type AbortableQuery<T extends QueryResult> = Promise<T> & {
    abortSignal: (signal: AbortSignal) => AbortableQuery<T>;
  };

  function resolvedQuery<T extends QueryResult>(result: T): AbortableQuery<T> {
    const query = Promise.resolve(result) as unknown as AbortableQuery<T>;
    query.abortSignal = vi.fn().mockReturnValue(query);
    return query;
  }

  function pendingQuery<T extends QueryResult>(): {
    query: AbortableQuery<T>;
    abortSignal: (signal: AbortSignal) => AbortableQuery<T>;
  } {
    let rejectQuery: (reason?: unknown) => void = () => undefined;
    const query = new Promise<T>((_resolve, reject) => {
      rejectQuery = reject;
    }) as unknown as AbortableQuery<T>;
    const abortSignal = vi.fn((signal: AbortSignal): AbortableQuery<T> => {
      signal.addEventListener("abort", () => rejectQuery(signal.reason), { once: true });
      return query;
    });
    query.abortSignal = abortSignal;
    return { query, abortSignal };
  }

  function channelClient(row: unknown, finaliseResult: boolean = true) {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [DELIVERY], error: null })
      .mockResolvedValueOnce({ data: finaliseResult, error: null })
      .mockResolvedValue({ data: [], error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
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
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://compliancehub.example");
    const fetcher = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const supabase = channelClient({ type: "slack", enabled: true, revoked_at: null, config: approvedConfig() });
    await expect(drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      AbortSignal.timeout(5_000),
    )).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });
    const sent = JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(sent.blocks).toContainEqual({
      type: "section",
      text: { type: "mrkdwn", text: "<https://compliancehub.example/app/integrations|Open ComplianceHub>" },
    });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  it("cancels an in-flight connection claim through the shared signal", async () => {
    const controller = new AbortController();
    const claim = pendingQuery<{ data: unknown[]; error: null }>();
    const rpc = vi.fn((name: string) => {
      if (name === "claim_github_connection_alert_delivery") return claim.query;
      return resolvedQuery({ data: true, error: null });
    });
    const supabase = { rpc, from: vi.fn() };
    const running = drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      controller.signal,
    );

    await vi.waitFor(() => expect(claim.abortSignal).toHaveBeenCalledWith(controller.signal));
    controller.abort(new Error("claim cancelled"));
    await expect(running).rejects.toThrow("claim cancelled");
    expect(rpc).toHaveBeenCalledWith("claim_github_connection_alert_delivery", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("complete_alert_delivery", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("fail_alert_delivery", expect.anything());
  });

  it("cancels an in-flight channel lookup through the shared signal", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", createHash("sha256").update(webhookUrl, "utf8").digest("hex"));
    const controller = new AbortController();
    const lookup = pendingQuery<{ data: unknown; error: null }>();
    const rpc = vi.fn((name: string) => {
      if (name === "claim_github_connection_alert_delivery") return resolvedQuery({ data: [DELIVERY], error: null });
      return resolvedQuery({ data: true, error: null });
    });
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      abortSignal: vi.fn((signal: AbortSignal) => {
        lookup.abortSignal(signal);
        return chain;
      }),
      maybeSingle: vi.fn(() => lookup.query),
    };
    const supabase = {
      rpc,
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) }),
    };
    const running = drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      controller.signal,
    );

    await vi.waitFor(() => expect(lookup.abortSignal).toHaveBeenCalledWith(controller.signal));
    controller.abort(new Error("channel lookup cancelled"));
    await expect(running).rejects.toThrow("channel lookup cancelled");
    expect(rpc).not.toHaveBeenCalledWith("complete_alert_delivery", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("fail_alert_delivery", expect.anything());
  });

  it("cancels an in-flight Slack post through the shared signal", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", createHash("sha256").update(webhookUrl, "utf8").digest("hex"));
    const controller = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      fetchSignal = init?.signal ?? undefined;
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const rpc = vi.fn((name: string) => {
      if (name === "claim_github_connection_alert_delivery") return resolvedQuery({ data: [DELIVERY], error: null });
      return resolvedQuery({ data: true, error: null });
    });
    const channel = { type: "slack", enabled: true, revoked_at: null, config: approvedConfig() };
    const maybeSingle = vi.fn().mockReturnValue(resolvedQuery({ data: channel, error: null }));
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      maybeSingle,
    };
    const supabase = {
      rpc,
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) }),
    };
    const running = drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      controller.signal,
    );

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    controller.abort(new Error("Slack post cancelled"));
    await expect(running).rejects.toThrow("Slack post cancelled");
    expect(fetchSignal?.aborted).toBe(true);
    expect(rpc).not.toHaveBeenCalledWith("complete_alert_delivery", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("fail_alert_delivery", expect.anything());
    vi.unstubAllGlobals();
  });

  it("cancels completion finalisation through the shared signal", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", createHash("sha256").update(webhookUrl, "utf8").digest("hex"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    const controller = new AbortController();
    const completion = pendingQuery<{ data: boolean; error: null }>();
    const rpc = vi.fn((name: string) => {
      if (name === "claim_github_connection_alert_delivery") return resolvedQuery({ data: [DELIVERY], error: null });
      if (name === "complete_alert_delivery") return completion.query;
      return resolvedQuery({ data: true, error: null });
    });
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnValue(resolvedQuery({ data: { type: "slack", enabled: true, revoked_at: null, config: approvedConfig() }, error: null })),
    };
    const supabase = {
      rpc,
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) }),
    };
    const running = drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      controller.signal,
    );

    await vi.waitFor(() => expect(completion.abortSignal).toHaveBeenCalledWith(controller.signal));
    controller.abort(new Error("completion cancelled"));
    await expect(running).rejects.toThrow("completion cancelled");
    expect(rpc).not.toHaveBeenCalledWith("fail_alert_delivery", expect.anything());
    vi.unstubAllGlobals();
  });

  it("cancels failure finalisation through the shared signal", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", createHash("sha256").update(webhookUrl, "utf8").digest("hex"));
    const controller = new AbortController();
    const failure = pendingQuery<{ data: boolean; error: null }>();
    const rpc = vi.fn((name: string) => {
      if (name === "claim_github_connection_alert_delivery") return resolvedQuery({ data: [DELIVERY], error: null });
      if (name === "fail_alert_delivery") return failure.query;
      return resolvedQuery({ data: true, error: null });
    });
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnValue(resolvedQuery({ data: { type: "slack", enabled: true, revoked_at: null, config: { ...approvedConfig(), webhookSha256: "0".repeat(64) } }, error: null })),
    };
    const supabase = {
      rpc,
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) }),
    };
    const running = drainSupabaseGitHubConnectionSlackAlertDeliveries(
      supabase as never,
      10,
      controller.signal,
    );

    await vi.waitFor(() => expect(failure.abortSignal).toHaveBeenCalledWith(controller.signal));
    controller.abort(new Error("failure finalisation cancelled"));
    await expect(running).rejects.toThrow("failure finalisation cancelled");
    expect(rpc).not.toHaveBeenCalledWith("complete_alert_delivery", expect.anything());
  });
});
