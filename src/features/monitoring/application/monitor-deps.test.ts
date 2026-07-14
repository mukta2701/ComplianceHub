import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMonitorDependencies } from "./monitor-deps";
import type { AlertChannel, AlertFinding } from "./deliver";

const finding: AlertFinding = {
  organisationId: "org1", sourceId: "src1", checkId: "github.branch_protection",
  controlRef: "A.8.32", subjectType: "github_repo", subjectId: "acme/isms",
  severity: "critical", title: "Production branch is unprotected", detail: "No protection rule on main.",
};

const channel: AlertChannel = {
  id: "whatsapp-1", type: "whatsapp", config: { to: "+447700900123" }, minSeverity: "high",
};

describe("buildMonitorDependencies WhatsApp delivery", () => {
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
    builder.select = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.then = vi.fn((resolve) => Promise.resolve({ data: [], error: null }).then(resolve));
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const deps = buildMonitorDependencies(supabase, { organisationId: "org1" });
    await expect(deps.listActiveSources()).resolves.toEqual([]);

    expect(builder.is).toHaveBeenCalledWith("revoked_at", null);
    expect(builder.eq).toHaveBeenCalledWith("enabled", true);
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", "org1");
  });

  it("loads only enabled external alert channels", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "in"]) builder[method] = vi.fn(() => builder);
    builder.then = vi.fn((resolve) => Promise.resolve({ data: [], error: null }).then(resolve));
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const deps = buildMonitorDependencies(supabase);
    await expect(deps.listExternalChannels("org1")).resolves.toEqual([]);

    expect(builder.eq).toHaveBeenCalledWith("organisation_id", "org1");
    expect(builder.eq).toHaveBeenCalledWith("enabled", true);
    expect(builder.is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("delivers in-app findings to both Owner and Admin operators", async () => {
    const membershipBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    membershipBuilder.select = vi.fn(() => membershipBuilder);
    membershipBuilder.eq = vi.fn(() => membershipBuilder);
    membershipBuilder.in = vi.fn(() => membershipBuilder);
    membershipBuilder.then = vi.fn((resolve) => Promise.resolve({
      data: [{ user_id: "owner-1" }, { user_id: "admin-1" }], error: null,
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
});
