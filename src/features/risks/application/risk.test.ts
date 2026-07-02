import { describe, expect, it } from "vitest";
import { riskInputSchema } from "./risk";

describe("risk application input", () => {
  it("accepts a complete 5x5 risk record", () => {
    expect(riskInputSchema.safeParse({ organisationId: "00000000-0000-4000-8000-000000000001", reference: "R-001", title: "Loss of service", description: "A critical service may become unavailable.", category: "Resilience", likelihood: 3, impact: 5, treatment: "mitigate", treatmentPlan: "Test recovery", residualLikelihood: 2, residualImpact: 3, status: "treating", evidence: "", reviewDate: "2026-08-01" }).success).toBe(true);
  });

  it("rejects ratings outside the 5x5 matrix", () => {
    expect(riskInputSchema.safeParse({ organisationId: "00000000-0000-4000-8000-000000000001", reference: "R-001", title: "Risk", description: "Description", category: "Ops", likelihood: 6, impact: 5, treatment: "mitigate", residualLikelihood: 1, residualImpact: 1, status: "open" }).success).toBe(false);
  });
});
