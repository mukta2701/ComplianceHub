export type AssessmentAnswer = "yes" | "partially" | "no" | "not_applicable";

export type AssessmentQuestion = Readonly<{
  id: string;
  category: string;
  prompt: string;
  weight: number;
  remediation: string;
}>;

export type AssessmentResponse = Readonly<{
  questionId: string;
  answer: AssessmentAnswer;
  evidenceNote?: string;
}>;

export type CategoryScore = Readonly<{ category: string; score: number; applicable: number }>;
export type AssessmentScore = Readonly<{
  overall: number | null;
  answered: number;
  applicable: number;
  categories: readonly CategoryScore[];
}>;

export type PriorityGap = Readonly<{
  questionId: string;
  category: string;
  prompt: string;
  remediation: string;
  answer: "partially" | "no";
  shortfall: number;
}>;
