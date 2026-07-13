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
});
