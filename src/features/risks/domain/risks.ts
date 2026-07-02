import type { AssessmentAnswer } from "../../assessment/domain/types";

export type RiskRating = 1 | 2 | 3 | 4 | 5;
export type RiskBand = "low" | "moderate" | "high" | "very_high";
export type GapForRisk = Readonly<{
  questionId: string;
  category: string;
  prompt: string;
  remediation: string;
  weight: number;
  answer: AssessmentAnswer;
}>;

export function calculateRiskScore(likelihood: number, impact: number): number {
  if (![likelihood, impact].every((value) => Number.isInteger(value) && value >= 1 && value <= 5)) {
    throw new RangeError("Likelihood and impact must be integers between 1 and 5");
  }
  return likelihood * impact;
}

export function riskBand(score: number): RiskBand {
  if (!Number.isInteger(score) || score < 1 || score > 25) throw new RangeError("Risk score must be between 1 and 25");
  if (score <= 4) return "low";
  if (score <= 9) return "moderate";
  if (score <= 14) return "high";
  return "very_high";
}

export function suggestRisksFromGaps(gaps: readonly GapForRisk[]) {
  return gaps.filter((gap) => gap.answer === "no" || gap.answer === "partially").map((gap) => ({
    sourceQuestionId: gap.questionId,
    category: gap.category,
    title: `Readiness gap: ${gap.prompt}`,
    description: `The organisation has assessed this area as ${gap.answer === "no" ? "not in place" : "partially in place"}.`,
    treatment: gap.remediation,
    suggestedLikelihood: Math.min(5, Math.max(1, gap.weight + (gap.answer === "no" ? 1 : 0))) as RiskRating,
    suggestedImpact: Math.min(5, Math.max(1, gap.weight)) as RiskRating,
    status: "suggested" as const,
  }));
}
