import { describe, expect, it } from "vitest";
import { buildReadinessReport } from "./readiness-report";

describe("buildReadinessReport", () => {
  it("folds SoA, risk, evidence, task and audit aggregates into one view", () => {
    const report = buildReadinessReport({
      soa: [{ status: "operational" }, { status: "not_applicable" }, { status: "pending" }],
      risks: [{ likelihood: 5, impact: 5 }, { likelihood: 1, impact: 1 }],
      tasks: { open: 4, overdue: 1 },
      evidence: [{ status: "current" }, { status: "expired" }, { status: "superseded" }],
      audits: [{ status: "in_progress" }, { status: "closed" }],
      openNonConformities: 2,
    });
    expect(report.soaPercent).toBe(45); // (0.9 + 0) / 2 applicable
    expect(report.riskBands).toEqual({ low: 1, moderate: 0, high: 0, very_high: 1 });
    expect(report.tasksOpen).toBe(4);
    expect(report.tasksOverdue).toBe(1);
    expect(report.evidence).toEqual({ total: 2, expiring: 0, expired: 1 });
    expect(report.openAudits).toBe(1);
    expect(report.openNonConformities).toBe(2);
  });

  it("honours a custom risk matrix config when banding scores", () => {
    const report = buildReadinessReport({
      soa: [],
      risks: [{ likelihood: 2, impact: 2 }],
      tasks: { open: 0, overdue: 0 },
      evidence: [],
      audits: [],
      openNonConformities: 0,
      config: { lowMax: 2, moderateMax: 3, highMax: 4, appetite: null },
    });
    // Score 4 falls in the "high" band under this config (default would be "low").
    expect(report.riskBands).toEqual({ low: 0, moderate: 0, high: 1, very_high: 0 });
    expect(report.soaPercent).toBe(0);
    expect(report.soaTotal).toBe(0);
  });
});
