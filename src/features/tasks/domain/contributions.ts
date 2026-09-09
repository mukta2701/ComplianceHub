import { z } from "zod";

const revision = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));
export const contributionInputSchema = z.object({
  taskId: z.uuid(), requestId: z.uuid(), assignmentRevision: revision,
  note: z.string().trim().min(1, "Describe your work or what is blocked.").max(10000),
});
export const reviewInputSchema = z.object({
  taskId: z.uuid(), contributionId: z.uuid(), requestId: z.uuid(),
  decision: z.enum(["accepted", "changes_requested"]),
  rationale: z.string().trim().min(1, "Explain your review decision.").max(2000),
});
export type Contribution = {
  id: string; submitter_id: string; assignment_revision: number; decision: string;
  note: string; created_at: string; reviewer_id: string | null; reviewed_at: string | null;
  rationale: string | null; evidence_id: string | null;
};
export type ContributionState = { error?: string; success?: string };

// Display hints only: the transactional RPC independently checks live authority.
export function contributionPermissions(input: {
  userId: string; ownerId: string | null; role: string; status: string; assignmentRevision: number;
  contributions: Pick<Contribution, "id" | "submitter_id" | "assignment_revision" | "decision">[];
}) {
  const open = input.status === "open" || input.status === "in_progress";
  const pending = input.contributions.filter((c) => c.decision === "pending" && c.assignment_revision === input.assignmentRevision);
  return {
    canSubmit: open && input.ownerId === input.userId && pending.length === 0,
    reviewableIds: open && (input.role === "owner" || input.role === "admin")
      ? pending.filter((c) => c.submitter_id !== input.userId && c.submitter_id === input.ownerId).map((c) => c.id) : [],
  };
}

export function contributionTime(value: string) {
  const date = new Date(value);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}
