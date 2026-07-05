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

export type RiskMatrixConfig = { lowMax: number; moderateMax: number; highMax: number; appetite: number | null };
export const DEFAULT_RISK_MATRIX_CONFIG: RiskMatrixConfig = { lowMax: 4, moderateMax: 9, highMax: 14, appetite: null };
export const RISK_BAND_LABEL: Record<RiskBand, string> = { low: "Low", moderate: "Medium", high: "High", very_high: "Critical" };

export type RiskStatus = "open" | "treating" | "accepted" | "closed";
export const RISK_STATUS_LABEL: Record<RiskStatus, string> = { open: "Open", treating: "Treating", accepted: "Accepted", closed: "Closed" };

export function riskBand(score: number, config: RiskMatrixConfig = DEFAULT_RISK_MATRIX_CONFIG): RiskBand {
  if (!Number.isInteger(score) || score < 1 || score > 25) throw new RangeError("Risk score must be between 1 and 25");
  if (score <= config.lowMax) return "low";
  if (score <= config.moderateMax) return "moderate";
  if (score <= config.highMax) return "high";
  return "very_high";
}

export function exceedsAppetite(score: number, config: RiskMatrixConfig): boolean {
  return config.appetite !== null && score > config.appetite;
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
