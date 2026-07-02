import { describe, expect, it } from "vitest";
import { calculateRiskScore, riskBand, suggestRisksFromGaps } from "./risks";

describe("risk matrix", () => {
  it("uses a 5 by 5 likelihood-impact matrix", () => {
    expect(calculateRiskScore(1, 1)).toBe(1);
    expect(calculateRiskScore(5, 5)).toBe(25);
    expect(() => calculateRiskScore(0, 3)).toThrow(/between 1 and 5/);
  });

  it("assigns documented risk bands", () => {
    expect([riskBand(4), riskBand(5), riskBand(10), riskBand(15), riskBand(25)]).toEqual([
      "low", "moderate", "high", "very_high", "very_high",
    ]);
  });
});

describe("suggestRisksFromGaps", () => {
  it("creates suggestions only for partial and no answers without persisting risks", () => {
    const suggestions = suggestRisksFromGaps([
      { questionId: "q1", category: "people", prompt: "Access reviews", remediation: "Review access", weight: 2, answer: "no" },
      { questionId: "q2", category: "people", prompt: "Training", remediation: "Train staff", weight: 1, answer: "partially" },
      { questionId: "q3", category: "assets", prompt: "Inventory", remediation: "List assets", weight: 1, answer: "yes" },
    ]);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({ sourceQuestionId: "q1", status: "suggested", treatment: "Review access" });
  });
});
