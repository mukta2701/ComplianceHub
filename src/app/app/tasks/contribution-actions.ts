"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { contributionInputSchema, reviewInputSchema, type ContributionState } from "@/features/tasks/domain/contributions";

const messages: Record<string, string> = {
  "task assignment changed; reload the task": "The assignment changed. Reload this task before continuing.",
  "task is closed": "This task is closed. A coordinator must reopen it before further contributions.",
  "only the current task assignee may submit": "Only the current assignee can submit work for this task.",
  "current workspace membership required": "Your workspace access has changed. Reload the page.",
  "only an independent workspace operator may review": "A different workspace coordinator must review this submission.",
  "a contribution is already awaiting review for this assignment": "A note is already awaiting review. Reload to see its status.",
  "contribution already reviewed": "This submission has already been reviewed. Reload to see the decision.",
  "request id already used with different submission": "This request was already saved with different content. Reload before submitting a new note.",
  "request id already used with different review": "This review request was already used. Reload to see the saved decision.",
};
function refresh(taskId: string) {
  revalidatePath(`/app/tasks/${taskId}`);
  revalidatePath("/app/tasks");
  revalidatePath("/app/baseline");
  revalidatePath("/app/evidence");
}
export async function submitTaskContributionAction(_state: ContributionState, form: FormData): Promise<ContributionState> {
  const { supabase, organisation, user } = await requireAppContext();
  const parsed = contributionInputSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your contribution details." };
  await enforceRateLimit(`task-contribution:${user.id}`, { limit: 30, windowMs: 60_000 });
  const input = parsed.data;
  const { data, error } = await supabase.rpc("submit_task_contribution", {
    target_organisation_id: organisation.id, target_task_id: input.taskId,
    expected_assignment_revision: input.assignmentRevision, submission_note: input.note, submission_request_id: input.requestId,
  });
  if (error || !data) return { error: messages[error?.message ?? ""] ?? "Could not save your contribution. Please try again." };
  refresh(input.taskId);
  return { success: "Your note is awaiting coordinator review." };
}
export async function reviewTaskContributionAction(_state: ContributionState, form: FormData): Promise<ContributionState> {
  const { supabase, organisation, membership, user } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") return { error: "Only a workspace coordinator can review contributions." };
  const parsed = reviewInputSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your review details." };
  await enforceRateLimit(`task-contribution-review:${user.id}`, { limit: 30, windowMs: 60_000 });
  const input = parsed.data;
  const { data, error } = await supabase.rpc("review_task_contribution", {
    target_organisation_id: organisation.id, target_contribution_id: input.contributionId,
    review_decision: input.decision, review_rationale: input.rationale, review_request_id: input.requestId,
  });
  if (error || !data) return { error: messages[error?.message ?? ""] ?? "Could not save your review. Please try again." };
  refresh(input.taskId);
  return { success: input.decision === "accepted" ? "Evidence accepted. Task and finding statuses are unchanged." : "Changes requested. The assignee can submit a new note." };
}
