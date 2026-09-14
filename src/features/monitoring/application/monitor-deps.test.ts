import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  decryptSecret: vi.fn(),
}));

vi.mock("@/lib/security/secrets", () => ({ decryptSecret: hoisted.decryptSecret }));

import { buildMonitorDependencies, postMonitoringSlackWebhook } from "./monitor-deps";
import type { AlertChannel, AlertFinding } from "./deliver";

const finding: AlertFinding = {
  organisationId: "org1", sourceId: "src1", checkId: "github.branch_protection",
  controlRef: "A.8.32", subjectType: "github_repo", subjectId: "acme/isms",
  severity: "critical", title: "Production branch is unprotected", detail: "No protection rule on main.",
};

const channel: AlertChannel = {
  id: "whatsapp-1", type: "whatsapp", config: { to: "+447700900123" }, minSeverity: "high",
};
const APPROVED_SLACK_WEBHOOK = "https://hooks.slack.com/services/T_TEST/B_TEST/S_TEST";
const APPROVED_SLACK_WEBHOOK_SHA256 = "36b243d5b0e2304cbdf6f5bf362061b4f0e5cdc842c7f407af9253d0207cce52";

describe("buildMonitorDependencies WhatsApp delivery", () => {
  beforeEach(() => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", APPROVED_SLACK_WEBHOOK_SHA256);
    hoisted.decryptSecret.mockReset();
    hoisted.decryptSecret.mockReturnValue(APPROVED_SLACK_WEBHOOK);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("constructs and injects the env-gated Twilio port", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC00000000000000000000000000000000");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test-auth-token");
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "+14155238886");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchImpl);

    const deps = buildMonitorDependencies({} as SupabaseClient);
    const result = await deps.deliver(channel, finding);

    expect(result.status).toBe("delivered");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("loads only enabled, non-revoked sources in the requested organisation", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "is", "eq", "order", "limit", "gt"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = vi.fn((resolve) => Promise.resolve({ data: [], error: null }).then(resolve));
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const deps = buildMonitorDependencies(supabase, { organisationId: "org1" });
    await expect(deps.listActiveSources()).resolves.toEqual([]);

    expect(builder.is).toHaveBeenCalledWith("revoked_at", null);
    expect(builder.eq).toHaveBeenCalledWith("enabled", true);
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", "org1");
    expect(builder.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(builder.limit).toHaveBeenCalledWith(500);
  });

  it("paginates every enabled external alert channel beyond the Supabase row ceiling", async () => {
    const rows = Array.from({ length: 1_205 }, (_, index) => ({
      id: String(index + 1).padStart(4, "0"),
      type: "slack",
      config: {},
      min_severity: "high",
    }));
    let afterId: string | null = null;
    let limit = 1_000;
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "in", "order"]) builder[method] = vi.fn(() => builder);
    builder.limit = vi.fn((value: number) => { limit = value; return builder; });
    builder.gt = vi.fn((_column: string, value: string) => { afterId = value; return builder; });
    builder.then = vi.fn((resolve) => Promise.resolve({
      data: rows.filter((row) => afterId === null || row.id > afterId).slice(0, limit),
      error: null,
    }).then(resolve));
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const deps = buildMonitorDependencies(supabase);
    await expect(deps.listExternalChannels("org1")).resolves.toHaveLength(1_205);

    expect(builder.eq).toHaveBeenCalledWith("organisation_id", "org1");
    expect(builder.eq).toHaveBeenCalledWith("enabled", true);
    expect(builder.is).toHaveBeenCalledWith("revoked_at", null);
    expect(builder.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(builder.limit).toHaveBeenCalledWith(500);
    expect(builder.gt).toHaveBeenCalledWith("id", "1000");
  });

  it("rejects a legacy Slack channel before decryption and isolates it from other delivery work", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "in", "order", "limit", "gt"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = vi.fn((resolve) => Promise.resolve({
      data: [{
        id: "slack-legacy",
        type: "slack",
        config: { webhookUrl: APPROVED_SLACK_WEBHOOK },
        min_severity: "high",
      }],
      error: null,
    }).then(resolve));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const deps = buildMonitorDependencies({ from: vi.fn(() => builder) } as unknown as SupabaseClient);

    const channels = await deps.listExternalChannels("org1");
    const result = await deps.deliver(channels[0]!, finding);

    expect(hoisted.decryptSecret).not.toHaveBeenCalled();
    expect(result).toEqual({
      channelId: "slack-legacy",
      type: "slack",
      status: "failed",
      reason: "Slack destination is not approved",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("decrypts only an approved stored Slack envelope and carries only the canonical URL to delivery", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "in", "order", "limit", "gt"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = vi.fn((resolve) => Promise.resolve({
      data: [{
        id: "slack-approved",
        type: "slack",
        config: { webhookUrl: "v1:iv:tag:data", webhookSha256: APPROVED_SLACK_WEBHOOK_SHA256 },
        min_severity: "high",
      }],
      error: null,
    }).then(resolve));
    const deps = buildMonitorDependencies({ from: vi.fn(() => builder) } as unknown as SupabaseClient);

    const channels = await deps.listExternalChannels("org1");

    expect(hoisted.decryptSecret).toHaveBeenCalledOnce();
    expect(channels).toEqual([{
      id: "slack-approved",
      type: "slack",
      config: { webhookUrl: APPROVED_SLACK_WEBHOOK },
      minSeverity: "high",
    }]);
  });

  it("paginates every open finding key beyond the Supabase row ceiling", async () => {
    const rows = Array.from({ length: 1_205 }, (_, index) => ({
      id: String(index + 1).padStart(4, "0"),
      check_id: `check-${index + 1}`,
      subject_id: `subject-${index + 1}`,
    }));
    const from = vi.fn(() => {
      let afterId: string | null = null;
      let limit = 1_000;
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order"]) builder[method] = vi.fn(() => builder);
      builder.limit = vi.fn((value: number) => { limit = value; return builder; });
      builder.gt = vi.fn((_column: string, value: string) => { afterId = value; return builder; });
      builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        const page = rows.filter((row) => afterId === null || row.id > afterId).slice(0, limit);
        return Promise.resolve({ data: page, error: null }).then(resolve);
      };
      return builder;
    });
    const deps = buildMonitorDependencies({ from } as unknown as SupabaseClient);

    const keys = await deps.listOpenFindingKeys("org1");

    expect(keys).toHaveLength(1_205);
    expect(keys.at(-1)).toBe("check-1205::subject-1205");
    expect(from).toHaveBeenCalledTimes(3);
  });

  it("scopes legacy monitoring reads, writes, and resolutions to the origin-aware identity", async () => {
    const builders: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
    const from = vi.fn(() => {
      const builder: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const method of ["select", "eq", "in", "order", "limit", "gt", "update"]) {
        builder[method] = vi.fn(() => builder);
      }
      builder.upsert = vi.fn().mockResolvedValue({ error: null });
      builder.then = vi.fn((resolve) => Promise.resolve({ data: [], error: null }).then(resolve));
      builders.push(builder);
      return builder;
    });
    const deps = buildMonitorDependencies({ from } as unknown as SupabaseClient);

    await deps.listOpenFindingKeys("org1");
    await deps.saveFinding(finding);
    await deps.resolveFindings("org1", ["github.branch_protection::acme/isms"]);

    const activeRead = builders[0]!;
    expect(activeRead.eq).toHaveBeenCalledWith("finding_origin", "legacy");
    expect(activeRead.in).toHaveBeenCalledWith("status", [
      "open", "acknowledged", "in_progress", "exception_requested", "risk_accepted",
    ]);

    expect(builders[1]!.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ finding_origin: "legacy", mapping_version: "legacy" }),
      { onConflict: "organisation_id,finding_origin,stable_subject_identity,check_id" },
    );

    const resolution = builders[2]!;
    expect(resolution.eq).toHaveBeenCalledWith("finding_origin", "legacy");
    expect(resolution.in).toHaveBeenCalledWith("status", [
      "open", "acknowledged", "in_progress", "exception_requested", "risk_accepted",
    ]);
  });

  it("delivers in-app findings to both Owner and Admin operators", async () => {
    const membershipBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    membershipBuilder.select = vi.fn(() => membershipBuilder);
    membershipBuilder.eq = vi.fn(() => membershipBuilder);
    membershipBuilder.in = vi.fn(() => membershipBuilder);
    membershipBuilder.order = vi.fn(() => membershipBuilder);
    membershipBuilder.limit = vi.fn(() => membershipBuilder);
    membershipBuilder.gt = vi.fn(() => membershipBuilder);
    membershipBuilder.then = vi.fn((resolve) => Promise.resolve({
      data: [{ user_id: "admin-1" }, { user_id: "owner-1" }], error: null,
    }).then(resolve));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn((table: string) => table === "memberships" ? membershipBuilder : { upsert }),
    } as unknown as SupabaseClient;

    const deps = buildMonitorDependencies(supabase);
    await deps.notifyInApp(finding);

    expect(membershipBuilder.in).toHaveBeenCalledWith("role", ["owner", "admin"]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "owner-1" }), expect.anything());
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "admin-1" }), expect.anything());
  });

  it("paginates every Owner and Admin operator beyond the Supabase row ceiling", async () => {
    const rows = Array.from({ length: 1_205 }, (_, index) => ({
      user_id: `operator-${String(index + 1).padStart(4, "0")}`,
    }));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table !== "memberships") return { upsert };
      let afterUserId: string | null = null;
      let limit = 1_000;
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order"]) builder[method] = vi.fn(() => builder);
      builder.limit = vi.fn((value: number) => { limit = value; return builder; });
      builder.gt = vi.fn((_column: string, value: string) => { afterUserId = value; return builder; });
      builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        const data = rows.filter((row) => afterUserId === null || row.user_id > afterUserId).slice(0, limit);
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return builder;
    });
    const deps = buildMonitorDependencies({ from } as unknown as SupabaseClient);

    await deps.notifyInApp(finding);

    expect(upsert).toHaveBeenCalledTimes(1_205);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "operator-1205" }), expect.anything());
  });
});

describe("monitoring Slack wrapper", () => {
  beforeEach(() => vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", APPROVED_SLACK_WEBHOOK_SHA256));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rechecks the current allow-policy before the shared transport can fetch", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", "b".repeat(64));

    await expect(postMonitoringSlackWebhook(
      APPROVED_SLACK_WEBHOOK,
      { text: "finding" },
    )).rejects.toThrow("Slack destination is not approved");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves the existing throw-on-non-2xx contract through the shared hardened transport", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    await expect(postMonitoringSlackWebhook(
      APPROVED_SLACK_WEBHOOK,
      { text: "finding" },
    )).rejects.toThrow("Slack webhook delivery failed");
  });

  it("accepts a successful shared transport response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(postMonitoringSlackWebhook(
      APPROVED_SLACK_WEBHOOK,
      { text: "finding" },
    )).resolves.toBeUndefined();
  });
});
