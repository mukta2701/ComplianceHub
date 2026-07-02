import type { AssessmentQuestion, AssessmentResponse, AssessmentScore, PriorityGap } from "./types";

const answerFactor = { yes: 1, partially: 0.5, no: 0 } as const;

export function calculateAssessmentScore(
  questions: readonly AssessmentQuestion[],
  responses: readonly AssessmentResponse[],
): AssessmentScore {
  const byQuestion = new Map(responses.map((response) => [response.questionId, response]));
  const totals = new Map<string, { earned: number; possible: number; applicable: number }>();
  let earned = 0;
  let possible = 0;
  let applicable = 0;

  for (const question of questions) {
    const answer = byQuestion.get(question.id)?.answer;
    if (!answer || answer === "not_applicable") continue;
    const value = question.weight * answerFactor[answer];
    earned += value;
    possible += question.weight;
    applicable += 1;
    const category = totals.get(question.category) ?? { earned: 0, possible: 0, applicable: 0 };
    category.earned += value;
    category.possible += question.weight;
    category.applicable += 1;
    totals.set(question.category, category);
  }

  return {
    overall: possible === 0 ? null : Math.round((earned / possible) * 100),
    answered: responses.filter((response) => questions.some((question) => question.id === response.questionId)).length,
    applicable,
    categories: [...totals].map(([category, value]) => ({
      category,
      score: Math.round((value.earned / value.possible) * 100),
      applicable: value.applicable,
    })),
  };
}

export function rankPriorityGaps(
  questions: readonly AssessmentQuestion[],
  responses: readonly AssessmentResponse[],
): readonly PriorityGap[] {
  const byQuestion = new Map(responses.map((response) => [response.questionId, response.answer]));
  return questions.flatMap((question): PriorityGap[] => {
    const answer = byQuestion.get(question.id);
    if (answer !== "no" && answer !== "partially") return [];
    return [{
      questionId: question.id,
      category: question.category,
      prompt: question.prompt,
      remediation: question.remediation,
      answer,
      shortfall: question.weight * (1 - answerFactor[answer]),
    }];
  }).sort((left, right) => right.shortfall - left.shortfall || left.questionId.localeCompare(right.questionId));
}
