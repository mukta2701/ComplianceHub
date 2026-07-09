import { describe, expect, it } from "vitest";
import { getAssessmentQuestionGuidance, getModuleGuidance } from "./guidance";

describe("getModuleGuidance", () => {
  it("explains why an assessment exists and what happens next", () => {
    const guidance = getModuleGuidance("assessment");

    expect(guidance.why).toMatch(/baseline/i);
    expect(guidance.nextStep).toMatch(/risk|task|evidence/i);
    expect(guidance.terms.some((term) => term.term === "Evidence")).toBe(true);
  });

  it("keeps the Statement of Applicability human-decision focused", () => {
    const guidance = getModuleGuidance("soa");

    expect(guidance.why).toMatch(/which controls apply/i);
    expect(guidance.outcome).toMatch(/audit/i);
    expect(guidance.terms.some((term) => term.term === "Applicable")).toBe(true);
  });
});

describe("getAssessmentQuestionGuidance", () => {
  it("provides answer definitions and evidence examples for an access-control question", () => {
    const guidance = getAssessmentQuestionGuidance({
      code: "OPS-01",
      prompt: "Are user access rights approved, reviewed and removed promptly?",
    });

    expect(guidance.why).toMatch(/access/i);
    expect(guidance.evidenceExamples).toContain("Recent access review record");
    expect(guidance.answerHelp.yes).toMatch(/evidence/i);
    expect(guidance.answerHelp.notApplicable).toMatch(/scope/i);
  });
});
