import { describe, expect, it } from "vitest";
import { calculateRiskScore, DEFAULT_RISK_MATRIX_CONFIG, exceedsAppetite, riskBand, suggestRisksFromGaps } from "./risks";

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

describe("configurable riskBand", () => {
  it("default config reproduces the legacy bands", () => {
    expect([riskBand(4), riskBand(5), riskBand(10), riskBand(15), riskBand(25)]).toEqual(["low", "moderate", "high", "very_high", "very_high"]);
  });
  it("honours custom thresholds", () => {
    const config = { lowMax: 2, moderateMax: 6, highMax: 12, appetite: 8 };
    expect([riskBand(2, config), riskBand(3, config), riskBand(7, config), riskBand(13, config)]).toEqual(["low", "moderate", "high", "very_high"]);
  });
  it("flags scores above appetite", () => {
    expect(exceedsAppetite(9, { ...DEFAULT_RISK_MATRIX_CONFIG, appetite: 8 })).toBe(true);
    expect(exceedsAppetite(8, { ...DEFAULT_RISK_MATRIX_CONFIG, appetite: 8 })).toBe(false);
    expect(exceedsAppetite(25, DEFAULT_RISK_MATRIX_CONFIG)).toBe(false); // null appetite ⇒ never exceeded
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
