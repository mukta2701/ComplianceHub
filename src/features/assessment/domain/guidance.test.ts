import { describe, expect, it } from "vitest";
import { getAssessmentGuidance } from "./guidance";

const productionQuestionCodes = [
  "GOV-01",
  "GOV-02",
  "RISK-01",
  "RISK-02",
  "OPS-01",
  "OPS-02",
  "OPS-03",
  "ASSURE-01",
  "ASSURE-02",
  "ASSURE-03",
] as const;

describe("assessment guidance", () => {
  it.each(productionQuestionCodes)("provides complete plain-English guidance for %s", (code) => {
    const guidance = getAssessmentGuidance(code);

    expect(guidance.whyItMatters.length).toBeGreaterThan(20);
    expect(guidance.startupBaseline.length).toBeGreaterThan(20);
    expect(guidance.evidenceExamples.length).toBeGreaterThan(0);
    expect(guidance.evidenceExamples.every((example) => example.length > 10)).toBe(true);
    expect(`${guidance.whyItMatters} ${guidance.startupBaseline}`).not.toMatch(/certif(?:y|ied|ication)|guarantee|legal requirement/i);
  });

  it("returns safe generic guidance for a future published question", () => {
    expect(getAssessmentGuidance("FUTURE-01")).toEqual({
      whyItMatters: expect.stringContaining("business"),
      startupBaseline: expect.stringContaining("owner"),
      evidenceExamples: expect.arrayContaining([expect.stringContaining("record")]),
    });
  });
});
