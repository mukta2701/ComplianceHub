import { describe, expect, it } from "vitest";
import { getSoaControlGuidance, summariseSoaReview } from "./soa-guidance";

describe("summariseSoaReview", () => {
  it("separates pending review from reviewed implementation states", () => {
    const summary = summariseSoaReview([
      { applicable: true, status: "pending", ownerId: null, evidence: "" },
      { applicable: true, status: "operational", ownerId: "00000000-0000-4000-8000-000000000001", evidence: "Access review Q2" },
      { applicable: false, status: "not_applicable", ownerId: null, evidence: "" },
    ]);

    expect(summary).toEqual({ total: 3, needsReview: 1, evidenceMissing: 1, ownerMissing: 1, applicable: 2 });
  });
});

describe("getSoaControlGuidance", () => {
  it("explains a technological control and offers a draft-only rationale", () => {
    const guidance = getSoaControlGuidance({ code: "8.5", title: "Strong authentication methods", applicable: true });

    expect(guidance.why).toMatch(/technology/i);
    expect(guidance.evidenceExamples).toContain("Identity-provider configuration export");
    expect(guidance.rationaleTemplate).toMatch(/human review/i);
  });
});
