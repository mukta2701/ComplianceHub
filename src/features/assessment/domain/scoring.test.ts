import { describe, expect, it } from "vitest";
import { calculateAssessmentScore, rankPriorityGaps } from "./scoring";
import type { AssessmentQuestion, AssessmentResponse } from "./types";

const questions: AssessmentQuestion[] = [
  { id: "q1", category: "leadership", prompt: "A", weight: 2, remediation: "Fix A" },
  { id: "q2", category: "leadership", prompt: "B", weight: 1, remediation: "Fix B" },
  { id: "q3", category: "operations", prompt: "C", weight: 3, remediation: "Fix C" },
  { id: "q4", category: "operations", prompt: "D", weight: 4, remediation: "Fix D" },
];

describe("calculateAssessmentScore", () => {
  it("excludes unanswered and not-applicable questions from the denominator", () => {
    const responses: AssessmentResponse[] = [
      { questionId: "q1", answer: "yes" },
      { questionId: "q2", answer: "partially" },
      { questionId: "q3", answer: "not_applicable" },
    ];
    expect(calculateAssessmentScore(questions, responses)).toEqual({
      overall: 83,
      answered: 3,
      applicable: 2,
      categories: [{ category: "leadership", score: 83, applicable: 2 }],
    });
  });

  it("returns no score when there are no applicable answers", () => {
    expect(calculateAssessmentScore(questions, [])).toMatchObject({ overall: null, applicable: 0 });
  });
});

describe("rankPriorityGaps", () => {
  it("orders gaps by weighted shortfall and excludes yes, NA, and unanswered", () => {
    const responses: AssessmentResponse[] = [
      { questionId: "q1", answer: "no" },
      { questionId: "q2", answer: "partially" },
      { questionId: "q3", answer: "no" },
      { questionId: "q4", answer: "not_applicable" },
    ];
    expect(rankPriorityGaps(questions, responses).map((gap) => gap.questionId)).toEqual(["q3", "q1", "q2"]);
  });
});
