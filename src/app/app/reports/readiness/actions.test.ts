import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "7c000000-0000-4000-8000-000000000001";
const report = { soaPercent: 75, soaTotal: 20, riskBands: { low: 2, moderate: 1, high: 0, very_high: 0 }, tasksOpen: 3, tasksOverdue: 1, evidence: { total: 5, expiring: 1, expired: 0 }, openAudits: 1, openNonConformities: 0 };
const hoisted = vi.hoisted(() => ({
  ctx: null as unknown, enforceRateLimit: vi.fn(), revalidatePath: vi.fn(),
  loadReadinessInput: vi.fn().mockResolvedValue({ source: "live" }), buildReadinessReport: vi.fn(),
}));
vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock("@/features/reports/application/load-readiness", () => ({ loadReadinessInput: hoisted.loadReadinessInput }));
vi.mock("@/features/reports/domain/readiness-report", () => ({ buildReadinessReport: hoisted.buildReadinessReport }));

import { publishLeadershipReportAction } from "./actions";

describe("publishLeadershipReportAction", () => {
  beforeEach(() => { vi.clearAllMocks(); hoisted.buildReadinessReport.mockReturnValue(report); });

  it("builds the reviewed live active-org report server-side and publishes through the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "snapshot-1", error: null });
    const supabase = { rpc };
    hoisted.ctx = { supabase, user: { id: "operator-1" }, organisation: { id: ORGANISATION_ID }, membership: { role: "admin" } };
    const form = new FormData(); form.set("payload", JSON.stringify({ soaPercent: 100 }));

    await publishLeadershipReportAction(form);

    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith("leadership-report:operator-1", { limit: 10, windowMs: 60_000 });
    expect(hoisted.loadReadinessInput).toHaveBeenCalledWith(supabase, ORGANISATION_ID);
    expect(rpc).toHaveBeenCalledWith("publish_leadership_report", { target_organisation_id: ORGANISATION_ID, report_payload: report });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/reports/readiness");
  });

  it("rejects Member callers before loading operational data", async () => {
    hoisted.ctx = { supabase: { rpc: vi.fn() }, user: { id: "member-1" }, organisation: { id: ORGANISATION_ID }, membership: { role: "member" } };

    await expect(publishLeadershipReportAction(new FormData())).rejects.toThrow("Only workspace operators can publish leadership reports");
    expect(hoisted.loadReadinessInput).not.toHaveBeenCalled();
  });

  it("does not publish when any live readiness source fails", async () => {
    const rpc = vi.fn();
    hoisted.ctx = { supabase: { rpc }, user: { id: "operator-1" }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" } };
    hoisted.loadReadinessInput.mockRejectedValueOnce(new Error("Could not load the readiness report"));

    await expect(publishLeadershipReportAction(new FormData())).rejects.toThrow("Could not load the readiness report");

    expect(rpc).not.toHaveBeenCalled();
  });
});
