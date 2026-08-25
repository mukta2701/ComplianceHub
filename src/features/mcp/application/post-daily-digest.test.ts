import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyDigestFacts, buildSlackDigestPayload, hashDailyDigestFacts } from "../domain/digest";
import {
  postDailyDigest,
  postSlackWebhook,
  reserveDelivery,
  validateSlackWebhookUrl,
  type PostDailyDigestDependencies,
} from "./post-daily-digest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "20000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "30000000-0000-4000-8000-000000000001";
const DELIVERY_ID = "40000000-0000-4000-8000-000000000001";
const APPROVED_SLACK_WEBHOOK = "https://hooks.slack.com/services/T_TEST/B_TEST/S_TEST";
const APPROVED_SLACK_WEBHOOK_SHA256 = "36b243d5b0e2304cbdf6f5bf362061b4f0e5cdc842c7f407af9253d0207cce52";
const DELIVERY_CLIENT = { kind: "server-only-delivery-client" } as unknown as import("@supabase/supabase-js").SupabaseClient;

const facts = buildDailyDigestFacts({
  workspace: { id: WORKSPACE_ID, name: "Acme" },
  localDate: "2026-08-07",
  overview: {
    soaPercent: 75, soaTotal: 4,
    riskBands: { low: 1, moderate: 1, high: 1, very_high: 0 },
    tasksOpen: 2, tasksOverdue: 1,
    evidence: { total: 3, expiring: 1, expired: 0 },
    openAudits: 1, openNonConformities: 0,
  },
  attentionItems: [], monitoringFindings: [], latestLeadershipReport: null,
  github: {
    partition: { activeCurrentPass: 0, activeCurrentFail: 0, activeCurrentUnknown: 0, activeCurrentNotApplicable: 0, activeStale: 0, historical: 0, total: 0 },
    baseline: null,
    changes: { counts: { newFailure: 0, reopen: 0, resolution: 0, supersedingPass: 0, total: 0 }, items: [], truncated: false },
    unknowns: { count: 0, items: [], truncated: false },
    staleResults: { count: 0, items: [], truncated: false },
    recommendedActions: { count: 0, items: [], truncated: false },
  },
});
const factHash = hashDailyDigestFacts(facts);
const message = { headline: "75% readiness", priorities: ["1 overdue task"], actions: ["Review 1 high risk"] };
const payload = buildSlackDigestPayload(message, { workspaceName: "Acme", localDate: "2026-08-07" });

function dependencies(overrides: Partial<PostDailyDigestDependencies> = {}): PostDailyDigestDependencies {
  return {
    resolveWorkspace: vi.fn(async () => ({ id: WORKSPACE_ID, name: "Acme", role: "owner" as const })),
    prepare: vi.fn(async () => ({ status: "ready" as const, facts, factHash, delivery: null })),
    rateLimit: vi.fn(async () => undefined),
    createDeliveryClient: vi.fn(() => DELIVERY_CLIENT),
    reserve: vi.fn(async () => ({
      state: "reserved" as const,
      deliveryId: DELIVERY_ID,
      channelId: CHANNEL_ID,
      attemptNumber: 1,
      message: payload,
    })),
    loadSelectedSlackDestination: vi.fn(async () => ({
      channelId: CHANNEL_ID,
      encryptedWebhook: "v1:iv:tag:data",
      webhookSha256: APPROVED_SLACK_WEBHOOK_SHA256,
    })),
    decryptWebhook: vi.fn(() => APPROVED_SLACK_WEBHOOK),
    isChannelActive: vi.fn(async () => true),
    deliver: vi.fn(async () => ({ outcome: "delivered" as const })),
    finalize: vi.fn(async () => true),
    ...overrides,
  };
}

const request = {
  workspaceId: WORKSPACE_ID,
  localDate: "2026-08-07",
  factHash,
  ...message,
};

describe("postDailyDigest", () => {
  beforeEach(() => vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", APPROVED_SLACK_WEBHOOK_SHA256));
  afterEach(() => vi.unstubAllEnvs());

  it("reserves the exact deterministic payload before posting and finalizes delivery", async () => {
    const order: string[] = [];
    const deps = dependencies({
      reserve: vi.fn(async (_client, input) => {
        order.push("reserve");
        expect(input.message).toEqual(payload);
        expect(input.expectedChannelId).toBe(CHANNEL_ID);
        return { state: "reserved" as const, deliveryId: DELIVERY_ID, channelId: CHANNEL_ID, attemptNumber: 1, message: input.message };
      }) as PostDailyDigestDependencies["reserve"],
      deliver: vi.fn(async (_url, outgoing) => {
        order.push("network");
        expect(outgoing).toEqual(payload);
        return { outcome: "delivered" as const };
      }) as PostDailyDigestDependencies["deliver"],
      finalize: vi.fn(async (_client, input) => {
        order.push("finalize");
        expect(input).toMatchObject({ deliveryId: DELIVERY_ID, attemptNumber: 1, outcome: "delivered" });
        return true;
      }),
    });

    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .resolves.toEqual({ workspace: { id: WORKSPACE_ID, name: "Acme" }, localDate: "2026-08-07", status: "delivered", delivery: { id: DELIVERY_ID, attemptNumber: 1 } });
    expect(order).toEqual(["reserve", "network", "finalize"]);
  });

  it("rejects a missing stored digest before decryption, limiting, service capability, reservation, audit, or network", async () => {
    const deps = dependencies({
      loadSelectedSlackDestination: vi.fn(async () => ({
        channelId: CHANNEL_ID,
        encryptedWebhook: "v1:iv:tag:data",
        webhookSha256: null,
      })),
    });

    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "SLACK_REJECTED" });

    expect(deps.decryptWebhook).not.toHaveBeenCalled();
    expect(deps.rateLimit).not.toHaveBeenCalled();
    expect(deps.createDeliveryClient).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.finalize).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("rejects a legacy plaintext webhook before decryption and every delivery mutation", async () => {
    const deps = dependencies({
      loadSelectedSlackDestination: vi.fn(async () => ({
        channelId: CHANNEL_ID,
        encryptedWebhook: APPROVED_SLACK_WEBHOOK,
        webhookSha256: APPROVED_SLACK_WEBHOOK_SHA256,
      })),
    });

    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "SLACK_REJECTED" });
    expect(deps.decryptWebhook).not.toHaveBeenCalled();
    expect(deps.rateLimit).not.toHaveBeenCalled();
    expect(deps.createDeliveryClient).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("loads and approves the selected destination with the user client before constructing the service client", async () => {
    const userClient = { kind: "user-client" } as never;
    const order: string[] = [];
    const deps = dependencies({
      loadSelectedSlackDestination: vi.fn(async () => {
        order.push("load-user");
        return { channelId: CHANNEL_ID, encryptedWebhook: "v1:iv:tag:data", webhookSha256: APPROVED_SLACK_WEBHOOK_SHA256 };
      }),
      decryptWebhook: vi.fn(() => { order.push("decrypt"); return APPROVED_SLACK_WEBHOOK; }),
      rateLimit: vi.fn(async () => { order.push("limit"); }),
      createDeliveryClient: vi.fn(() => { order.push("service"); return DELIVERY_CLIENT; }),
      reserve: vi.fn(async () => {
        order.push("reserve");
        return { state: "reserved" as const, deliveryId: DELIVERY_ID, channelId: CHANNEL_ID, attemptNumber: 1, message: payload };
      }),
      isChannelActive: vi.fn(async () => { order.push("active"); return true; }),
      deliver: vi.fn(async () => { order.push("network"); return { outcome: "delivered" as const }; }),
      finalize: vi.fn(async () => { order.push("finalize"); return true; }),
    });

    await postDailyDigest({ supabase: userClient, userId: USER_ID, clientId: "codex", input: request }, deps);

    expect(deps.loadSelectedSlackDestination).toHaveBeenCalledWith(userClient, { workspaceId: WORKSPACE_ID });
    expect(order).toEqual(["load-user", "decrypt", "limit", "service", "reserve", "active", "network", "finalize"]);
  });

  it.each(["admin", "member"] as const)("rejects a %s before rate limit, preparation, reservation, or network", async (role) => {
    const deps = dependencies({ resolveWorkspace: vi.fn(async () => ({ id: WORKSPACE_ID, name: "Acme", role })) });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deps.rateLimit).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.createDeliveryClient).not.toHaveBeenCalled();
  });

  it("rejects stale and semantically unsupported text before reservation or network", async () => {
    const stale = dependencies();
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: { ...request, factHash: "a".repeat(64) } }, stale))
      .rejects.toMatchObject({ code: "STALE_DIGEST" });
    expect(stale.reserve).not.toHaveBeenCalled();
    expect(stale.deliver).not.toHaveBeenCalled();
    expect(stale.createDeliveryClient).not.toHaveBeenCalled();

    const unsupported = dependencies();
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: { ...request, priorities: ["3 overdue tasks"] } }, unsupported))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(unsupported.reserve).not.toHaveBeenCalled();
    expect(unsupported.deliver).not.toHaveBeenCalled();
    expect(unsupported.createDeliveryClient).not.toHaveBeenCalled();
  });

  it.each([
    "All systems are secure",
    "No customer data is at risk",
    "nine overdue tasks",
  ])("rejects unsupported text before constructing the server-only delivery client: %s", async (headline) => {
    const deps = dependencies();
    await expect(postDailyDigest({
      supabase: {} as never,
      userId: USER_ID,
      clientId: "codex",
      input: { ...request, headline },
    }, deps)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deps.createDeliveryClient).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ["already_delivered", "ALREADY_POSTED"],
    ["delivery_reserved", "DELIVERY_UNKNOWN"],
    ["delivery_unknown", "DELIVERY_UNKNOWN"],
  ] as const)("maps prepared state %s without a reservation or network call", async (status, code) => {
    const deps = dependencies({ prepare: vi.fn(async () => ({ status, facts, factHash, delivery: { id: DELIVERY_ID, deliveredAt: null, factHash } })) });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code });
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("uses the immutable persisted payload when explicitly retrying a confirmed failure", async () => {
    const original = buildSlackDigestPayload({ headline: "Original", priorities: [], actions: [] }, { workspaceName: "Acme", localDate: "2026-08-07" });
    const deps = dependencies({
      prepare: vi.fn(async () => ({ status: "delivery_failed" as const, facts, factHash, delivery: { id: DELIVERY_ID, deliveredAt: null, factHash } })),
      reserve: vi.fn(async () => ({ state: "reserved" as const, deliveryId: DELIVERY_ID, channelId: CHANNEL_ID, attemptNumber: 2, message: original })),
    });
    await postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps);
    expect(deps.deliver).toHaveBeenCalledWith(APPROVED_SLACK_WEBHOOK, original);
  });

  it("rejects a schema-v1 failed delivery whose immutable hash differs before service client, reservation, or transport", async () => {
    const legacyHash = "c".repeat(64);
    const deps = dependencies({
      prepare: vi.fn(async () => ({
        status: "delivery_failed" as const,
        facts,
        factHash,
        delivery: { id: DELIVERY_ID, deliveredAt: null, factHash: legacyHash },
      })),
    });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "STALE_DIGEST" });
    expect(deps.createDeliveryClient).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ["no_digest_channel", "NO_DIGEST_CHANNEL"],
    ["already_posted", "ALREADY_POSTED"],
    ["delivery_unknown", "DELIVERY_UNKNOWN"],
  ] as const)("maps reservation state %s without contacting Slack", async (state, code) => {
    const deps = dependencies({ reserve: vi.fn(async () => ({ state })) as never });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code });
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", "SLACK_REJECTED", "SLACK_REJECTED"],
    ["failed", "RATE_LIMITED", "RATE_LIMITED"],
    ["unknown", "DELIVERY_UNKNOWN", "DELIVERY_UNKNOWN"],
  ] as const)("persists a %s outcome before returning %s", async (outcome, errorCode, expected) => {
    const deps = dependencies({ deliver: vi.fn(async () => ({ outcome, errorCode })) as PostDailyDigestDependencies["deliver"] });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: expected });
    expect(deps.finalize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome, errorCode }));
  });

  it("returns DELIVERY_UNKNOWN and never retries when finalization cannot be confirmed", async () => {
    const deps = dependencies({ finalize: vi.fn(async () => false) });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "DELIVERY_UNKNOWN" });
    expect(deps.deliver).toHaveBeenCalledTimes(1);
  });

  it("maps a finalization authorization error after transport to DELIVERY_UNKNOWN", async () => {
    const deps = dependencies({
      finalize: vi.fn(async () => { throw Object.assign(new Error("demoted"), { code: "42501" }); }),
    });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "DELIVERY_UNKNOWN" });
    expect(deps.deliver).toHaveBeenCalledTimes(1);
  });

  it("treats an invalid stored webhook as a confirmed configuration failure without network access", async () => {
    const deps = dependencies({ decryptWebhook: vi.fn(() => "https://hooks.slack.com.evil.test/services/T/B/secret") });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "SLACK_REJECTED" });
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.finalize).not.toHaveBeenCalled();
  });

  it("rechecks the configured channel immediately before network delivery", async () => {
    const deps = dependencies({ isChannelActive: vi.fn(async () => false) });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "NO_DIGEST_CHANNEL" });
    expect(deps.isChannelActive).toHaveBeenCalledWith(DELIVERY_CLIENT, {
      workspaceId: WORKSPACE_ID,
      channelId: CHANNEL_ID,
    });
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledWith(DELIVERY_CLIENT, expect.objectContaining({
      actorUserId: USER_ID,
      outcome: "failed",
      errorCode: "NO_DIGEST_CHANNEL",
    }));
  });

  it("fails a final allow-policy recheck as confirmed SLACK_REJECTED without network", async () => {
    const deps = dependencies({
      isChannelActive: vi.fn(async () => {
        vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", "b".repeat(64));
        return true;
      }),
    });

    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "SLACK_REJECTED" });

    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledWith(DELIVERY_CLIENT, expect.objectContaining({
      outcome: "failed",
      errorCode: "SLACK_REJECTED",
    }));
  });

  it("persists a retryable INTERNAL_ERROR when active-channel preflight fails before transport", async () => {
    const deps = dependencies({
      isChannelActive: vi.fn(async () => { throw new Error("database unavailable"); }),
    });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledWith(DELIVERY_CLIENT, expect.objectContaining({
      actorUserId: USER_ID,
      outcome: "failed",
      errorCode: "INTERNAL_ERROR",
    }));
  });

  it("returns DELIVERY_UNKNOWN when preflight-failure finalization cannot be confirmed", async () => {
    const deps = dependencies({
      isChannelActive: vi.fn(async () => { throw new Error("database unavailable"); }),
      finalize: vi.fn(async () => false),
    });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, deps))
      .rejects.toMatchObject({ code: "DELIVERY_UNKNOWN" });
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("separates confirmed local configuration failures from ambiguous transport failures", async () => {
    const localFailure = dependencies({ decryptWebhook: vi.fn(() => { throw new Error("cannot decrypt"); }) });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, localFailure))
      .rejects.toMatchObject({ code: "SLACK_REJECTED" });
    expect(localFailure.deliver).not.toHaveBeenCalled();
    expect(localFailure.finalize).not.toHaveBeenCalled();

    const transportFailure = dependencies({ deliver: vi.fn(async () => { throw new TypeError("network"); }) });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex", input: request }, transportFailure))
      .rejects.toMatchObject({ code: "DELIVERY_UNKNOWN" });
    expect(transportFailure.finalize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" }));
  });

  it("maps the action limiter without exposing raw user or client IDs in its key", async () => {
    const rateLimit: PostDailyDigestDependencies["rateLimit"] = vi.fn(async (key: string) => { void key; throw new Error("limited"); });
    const deps = dependencies({ rateLimit });
    await expect(postDailyDigest({ supabase: {} as never, userId: USER_ID, clientId: "codex-client", input: request }, deps))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });
    const key = vi.mocked(rateLimit).mock.calls[0]?.[0] ?? "";
    expect(key).toMatch(/^mcp-post-digest:[0-9a-f]{64}$/);
    expect(key).not.toContain(USER_ID);
    expect(key).not.toContain("codex-client");
  });
});

describe("daily digest reservation error mapping", () => {
  const input = {
    actorUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    localDate: "2026-08-07",
    factHash,
    message: payload,
    expectedChannelId: CHANNEL_ID,
  };

  it("maps an Owner revocation SQLSTATE to FORBIDDEN before any network call", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: null, error: { code: "42501" } })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    await expect(reserveDelivery(supabase, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps other reservation database failures to INTERNAL_ERROR", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: null, error: { code: "57014" } })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    await expect(reserveDelivery(supabase, input)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});

describe("Slack digest transport", () => {
  beforeEach(() => vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", APPROVED_SLACK_WEBHOOK_SHA256));
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    APPROVED_SLACK_WEBHOOK,
  ])("accepts an official incoming-webhook URL: %s", (url) => {
    expect(validateSlackWebhookUrl(url).toString()).toBe(url);
  });

  it.each([
    "http://hooks.slack.com/services/T/B/secret",
    "https://hooks.slack.com.evil.test/services/T/B/secret",
    "https://user:pass@hooks.slack.com/services/T/B/secret",
    "https://hooks.slack.com:444/services/T/B/secret",
    "https://hooks.slack.com/services/T/B/secret?redirect=evil",
    "https://hooks.slack.com/services/T/B/secret#fragment",
    "https://hooks.slack.com/not-services/T/B/secret",
  ])("rejects an unsafe webhook URL: %s", (url) => {
    expect(() => validateSlackWebhookUrl(url)).toThrow();
  });

  it.each([
    [200, "delivered", undefined],
    [204, "delivered", undefined],
    [400, "failed", "SLACK_REJECTED"],
    [404, "failed", "SLACK_REJECTED"],
    [429, "failed", "RATE_LIMITED"],
    [408, "unknown", "DELIVERY_UNKNOWN"],
    [302, "unknown", "DELIVERY_UNKNOWN"],
    [500, "unknown", "DELIVERY_UNKNOWN"],
  ] as const)("classifies Slack HTTP %s as %s", async (status, outcome, errorCode) => {
    const fetcher = vi.fn(async () => new Response(status === 204 ? null : "do-not-read", { status }));
    await expect(postSlackWebhook(APPROVED_SLACK_WEBHOOK, payload, { fetcher, timeoutMs: 50 }))
      .resolves.toEqual({ outcome, ...(errorCode ? { errorCode } : {}) });
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: "POST", redirect: "error", headers: { "content-type": "application/json" } }));
  });

  it("classifies timeouts, DNS, TLS, and redirect failures as unknown", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("network secret detail"); });
    await expect(postSlackWebhook(APPROVED_SLACK_WEBHOOK, payload, { fetcher, timeoutMs: 50 }))
      .resolves.toEqual({ outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" });
  });
});
