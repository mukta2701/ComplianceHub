export type AssessmentAnswer = "yes" | "partially" | "no" | "not_applicable" | null | undefined;

export type AssessmentActionDraft = {
  title: string;
  detail: string;
  evidencePrompt: string;
  taskHref: string;
  riskHref: string;
};

export function getAssessmentActionDraft(question: { id: string; code: string; prompt: string }, answer: AssessmentAnswer): AssessmentActionDraft | null {
  if (answer !== "partially" && answer !== "no") return null;
  const severity = answer === "no" ? "not currently implemented" : "partially implemented";
  const title = `Close gap: ${question.prompt}`;
  const detail = `${question.code} is ${severity}. Confirm the current process, assign an owner, implement the missing practice, and retain evidence that it is operating.`;
  const parameters = new URLSearchParams({
    source: "assessment",
    title: `Readiness gap: ${question.prompt}`,
    description: `Assessment ${question.code} is ${severity}. Consider the business impact if this control remains incomplete.`,
    treatmentPlan: detail,
  });
  return {
    title,
    detail,
    evidencePrompt: "Add current evidence, such as a record, report, approval, or review result that demonstrates the practice is operating.",
    taskHref: `/app/tasks/from-gap?questionId=${question.id}`,
    riskHref: `/app/risks/new?${parameters.toString()}`,
  };
}
