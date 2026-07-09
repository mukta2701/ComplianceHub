import { describe, expect, it } from "vitest";
import { getAssessmentActionDraft } from "./assessment-action-draft";

const question = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "OPS-01",
  prompt: "Are user access rights approved, reviewed and removed promptly?",
};

describe("getAssessmentActionDraft", () => {
  it("creates review-only task and risk drafts for a partial answer", () => {
    const draft = getAssessmentActionDraft(question, "partially", "00000000-0000-4000-8000-000000000099");

    expect(draft?.title).toMatch(/access rights/i);
    expect(draft?.taskHref).toBe(`/app/tasks/from-gap?questionId=${question.id}`);
    expect(draft?.riskHref).toContain("/app/risks/new?");
    expect(draft?.riskHref).toContain("source=assessment");
    expect(draft?.riskHref).toContain("sourceAssessmentSessionId=00000000-0000-4000-8000-000000000099");
    expect(draft?.evidencePrompt).toMatch(/evidence/i);
  });

  it("does not suggest remediation for a yes or scope-based exclusion", () => {
    expect(getAssessmentActionDraft(question, "yes", "00000000-0000-4000-8000-000000000099")).toBeNull();
    expect(getAssessmentActionDraft(question, "not_applicable", "00000000-0000-4000-8000-000000000099")).toBeNull();
  });
});
