import { deriveEvidenceStatus } from "../../evidence/domain/evidence";
import { isPolicyReviewDue } from "../../policies/domain/review";
import { isOverdue, type TaskStatus } from "../../tasks/domain/tasks";

export type SweepEvidence = Readonly<{
  id: string; organisationId: string; title: string; ownerId: string | null;
  status: "current" | "expiring" | "expired"; validUntil: string | null;
}>;
export type SweepTask = Readonly<{
  id: string; organisationId: string; title: string; ownerId: string | null;
  status: TaskStatus; dueOn: string | null;
}>;
export type SweepPolicy = Readonly<{
  id: string; organisationId: string; reference: string; title: string;
  ownerId: string | null; reviewDue: string | null;
}>;

export function planEvidenceTransitions(evidence: readonly SweepEvidence[], today: string) {
  return evidence.flatMap((item) => {
    const derived = deriveEvidenceStatus(item.validUntil, today);
    if (derived === "current" || derived === item.status) return [];
    return [{ evidenceId: item.id, organisationId: item.organisationId, title: item.title, ownerId: item.ownerId, to: derived }];
  });
}

export function planExpiryTasks(
  evidence: readonly SweepEvidence[], openExpiryTaskEvidenceIds: readonly string[], today: string,
) {
  const covered = new Set(openExpiryTaskEvidenceIds);
  return evidence
    .filter((item) => !covered.has(item.id) && deriveEvidenceStatus(item.validUntil, today) !== "current")
    .map((item) => ({
      organisationId: item.organisationId, evidenceId: item.id,
      title: `Replace stale evidence: ${item.title}`.slice(0, 200), ownerId: item.ownerId, dueOn: item.validUntil,
    }));
}

export function planOverdueTaskAlerts(tasks: readonly SweepTask[], today: string) {
  return tasks
    .filter((task) => isOverdue({ status: task.status, dueOn: task.dueOn }, today))
    .map((task) => ({ organisationId: task.organisationId, taskId: task.id, title: task.title, ownerId: task.ownerId }));
}

export function planPolicyReviewTasks(
  policies: readonly SweepPolicy[], openPolicyReviewPolicyIds: readonly string[], today: string,
) {
  const covered = new Set(openPolicyReviewPolicyIds);
  return policies
    .filter((policy) => !covered.has(policy.id) && isPolicyReviewDue(policy.reviewDue, today))
    .map((policy) => ({
      organisationId: policy.organisationId, policyId: policy.id, reference: policy.reference,
      title: policy.title, ownerId: policy.ownerId, dueOn: policy.reviewDue,
    }));
}
