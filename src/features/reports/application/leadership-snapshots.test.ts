import { describe, expect, it, vi } from "vitest";
import { loadLatestLeadershipSnapshot, readinessReportSchema } from "./leadership-snapshots";

const ORGANISATION_ID = "7d000000-0000-4000-8000-000000000001";
const payload = { soaPercent: 75, soaTotal: 20, riskBands: { low: 2, moderate: 1, high: 0, very_high: 0 }, tasksOpen: 3, tasksOverdue: 1, evidence: { total: 5, expiring: 1, expired: 0 }, openAudits: 1, openNonConformities: 0 };

describe("leadership snapshots", () => {
  it("validates the exact reviewed report shape and consistency", () => {
    expect(readinessReportSchema.parse(payload)).toEqual(payload);
    expect(() => readinessReportSchema.parse({ ...payload, tasksOpen: 0, tasksOverdue: 1 })).toThrow();
    expect(() => readinessReportSchema.parse({ ...payload, tasksOpen: 1_000_001 })).toThrow();
    expect(() => readinessReportSchema.parse({ ...payload, evidence: { total: 5, expiring: 4, expired: 2 } })).toThrow();
    expect(() => readinessReportSchema.parse({ ...payload, extra: "not reviewed" })).toThrow();
  });

  it("loads only the latest active-org snapshot and validates its payload", async () => {
    const result = { data: { id: "7d000000-0000-4000-8000-000000000002", organisation_name: "Published Ltd", payload, published_at: "2026-07-14T07:30:00Z", publisher: { display_name: "Morgan Owner" } }, error: null };
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result) };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.order.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
    const supabase = { from: vi.fn(() => chain) };

    await expect(loadLatestLeadershipSnapshot(supabase as never, ORGANISATION_ID)).resolves.toMatchObject({ id: "7d000000-0000-4000-8000-000000000002", payload });
    expect(supabase.from).toHaveBeenCalledWith("leadership_report_snapshots");
    expect(chain.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(chain.order).toHaveBeenCalledWith("published_at", { ascending: false });
    expect(chain.order).toHaveBeenCalledWith("id", { ascending: false });
  });
});
