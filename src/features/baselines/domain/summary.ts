import { z } from "zod";
import { assessScopeProfile } from "@/features/scope/domain/scope-profile";
import { deriveEffectiveEvidenceStatus, summariseEvidenceFreshness } from "@/features/evidence/domain/evidence";
import { DEFAULT_RISK_MATRIX_CONFIG, riskBand, exceedsAppetite, calculateRiskScore } from "@/features/risks/domain/risks";

const scopeSchema = z.object({ scope_statement: z.string(), services: z.string(), locations: z.string(), information_types: z.string(), dependencies: z.string(), exclusions: z.string(), updated_at: z.string() });
const taskSchema = z.object({ id: z.string(), title: z.string(), status: z.string(), owner_id: z.string().nullable(), owner_name: z.string().nullable(), due_on: z.string().nullable(), updated_at: z.string(), assignment_revision: z.number() });
export const baselinePayloadSchema = z.object({
  schemaVersion: z.literal(1), calculationVersion: z.number().int(), organisationId: z.string(), organisationName: z.string(), objective: z.string(), savedAt: z.string(), progressRevision: z.number(),
  scope: scopeSchema.nullable(),
  assessment: z.object({ id: z.string(), title: z.string(), revision: z.number(), catalogue_version_id: z.string(), catalogue_version: z.string(), updated_at: z.string() }).nullable(),
  questions: z.array(z.object({ id: z.string(), prompt: z.string(), answer: z.enum(["yes", "partially", "no", "not_applicable"]).nullable(), evidence_note: z.string(), updated_at: z.string().nullable() })),
  tasks: z.array(taskSchema),
  contributions: z.array(z.object({ id: z.string(), task_id: z.string(), assignment_revision: z.number(), submitter_id: z.string(), submitter_name: z.string().nullable(), reviewer_id: z.string().nullable(), reviewer_name: z.string().nullable(), decision: z.enum(["pending", "accepted", "changes_requested"]), note: z.string(), rationale: z.string().nullable(), evidence_id: z.string().nullable(), created_at: z.string(), reviewed_at: z.string().nullable() })),
  evidence: z.array(z.object({ id: z.string(), title: z.string(), kind: z.enum(["file", "link", "note"]), description: z.string(), status: z.enum(["current", "expiring", "expired", "superseded", "withdrawn"]), valid_until: z.string().nullable(), collected_on: z.string(), created_at: z.string() })),
  risks: z.array(z.object({ id: z.string(), reference: z.string(), title: z.string(), status: z.enum(["open", "treating", "accepted", "closed"]), residual_likelihood: z.number(), residual_impact: z.number(), owner_id: z.string().nullable(), owner_name: z.string().nullable(), review_date: z.string().nullable(), updated_at: z.string() })),
  riskConfig: z.object({ low_max: z.number(), moderate_max: z.number(), high_max: z.number(), appetite_threshold: z.number().nullable() }).nullable(),
  counts: z.record(z.string(), z.number()).optional(),
});
export type BaselinePayload = z.infer<typeof baselinePayloadSchema>;
export type BaselineState = { error?: string; success?: string; revision?: number; snapshotId?: string | null; requestId?: string };
export const baselineInputSchema = z.object({
  objective: z.string().trim().min(1, "Describe the objective for this baseline.").max(2000),
  assessmentId: z.union([z.uuid(), z.literal("")]),
  revision: z.coerce.number().int().min(0), requestId: z.uuid(), intent: z.enum(["progress", "snapshot"]),
});

// Calculation version 1: run against preserved inputs and savedAt, never today.
export function summariseBaseline(payload: BaselinePayload) {
  const scope = payload.scope;
  const scopeGaps = assessScopeProfile({ scopeStatement: scope?.scope_statement ?? "", services: scope?.services ?? "", locations: scope?.locations ?? "", informationTypes: scope?.information_types ?? "", dependencies: scope?.dependencies ?? "", exclusions: scope?.exclusions ?? "" });
  const today = payload.savedAt.slice(0, 10);
  const openTasks = payload.tasks.filter((task) => task.status === "open" || task.status === "in_progress");
  const overdueTasks = openTasks.filter((task) => task.due_on !== null && task.due_on < today);
  const unassignedTasks = openTasks.filter((task) => !task.owner_id);
  const undatedTasks = openTasks.filter((task) => !task.due_on);
  const pending = payload.contributions.filter((item) => item.decision === "pending");
  const pendingReviews = pending.filter((item) => openTasks.some((task) => task.id === item.task_id && task.assignment_revision === item.assignment_revision && task.owner_id === item.submitter_id));
  const obsoletePendingReviews = pending.filter((item) => !pendingReviews.includes(item));
  const evidenceItems = payload.evidence.map((item) => ({ ...item, status: deriveEffectiveEvidenceStatus(item.status, item.valid_until, today) }));
  const evidence = summariseEvidenceFreshness(evidenceItems);
  const unanswered = payload.questions.filter((question) => question.answer === null).length;
  const assessmentGaps = payload.questions.filter((question) => question.answer === null || question.answer === "no" || question.answer === "partially");
  const missingAnswerEvidence = payload.questions.filter((question) => question.answer !== null && question.answer !== "not_applicable" && !question.evidence_note.trim()).length;
  const config = payload.riskConfig ? { lowMax: payload.riskConfig.low_max, moderateMax: payload.riskConfig.moderate_max, highMax: payload.riskConfig.high_max, appetite: payload.riskConfig.appetite_threshold } : DEFAULT_RISK_MATRIX_CONFIG;
  const risks = payload.risks.filter((risk) => risk.status !== "closed").map((risk) => {
    const score = calculateRiskScore(risk.residual_likelihood, risk.residual_impact);
    return { ...risk, band: riskBand(score, config), exceedsAppetite: exceedsAppetite(score, config) };
  }).sort((a, b) => b.residual_likelihood * b.residual_impact - a.residual_likelihood * a.residual_impact);
  const limitations = [
    ...(!payload.assessment ? ["No assessment was selected."] : []),
    ...(payload.assessment && payload.questions.length === 0 ? ["The selected assessment has no catalogue questions."] : []),
    ...(unanswered ? [`${unanswered} assessment questions were unanswered.`] : []),
    ...(missingAnswerEvidence ? [`${missingAnswerEvidence} answered questions had no supporting evidence note.`] : []),
    ...(evidence.total === 0 ? ["No active evidence records were captured."] : []),
    ...(evidence.expired ? [`${evidence.expired} evidence records had expired at the saved date.`] : []),
    ...(evidence.expiring ? [`${evidence.expiring} evidence records were due to expire within 30 days.`] : []),
    "Completing a task does not verify that the underlying issue is resolved.",
    "Coordinator acceptance records a human review of a note; it is not a live provider result.",
    "This baseline does not evaluate live provider verification or certification readiness.",
    "Viewing this baseline does not record leadership approval.",
  ];
  return { scopeGaps, partial: scopeGaps.length > 0 || !payload.assessment || payload.questions.length === 0 || unanswered > 0 || missingAnswerEvidence > 0 || evidence.total === 0 || evidence.expired > 0, unanswered, assessmentGaps, missingAnswerEvidence, openTasks, tasksOpen: openTasks.length, overdueTasks, unassignedTasks, undatedTasks, pendingReviews, obsoletePendingReviews, evidence, evidenceItems, risks, limitations };
}
function scopeBasis(payload: BaselinePayload) {
  const scope = payload.scope;
  return scope ? [scope.scope_statement, scope.services, scope.locations, scope.information_types, scope.dependencies, scope.exclusions] : null;
}
export function compareBaselines(current: BaselinePayload, previous: BaselinePayload | null) {
  const incompatible = (reason: string) => ({ comparable: false as const, reason, changes: [] as string[] });
  if (!previous) return incompatible("No previous saved baseline is available for comparison.");
  if (current.schemaVersion !== previous.schemaVersion || current.calculationVersion !== previous.calculationVersion) return incompatible("The schema or calculation version changed; these baselines cannot be compared.");
  if (current.organisationId !== previous.organisationId || current.objective !== previous.objective) return incompatible("The workspace or objective changed; these baselines cannot be compared.");
  if (JSON.stringify(scopeBasis(current)) !== JSON.stringify(scopeBasis(previous))) return incompatible("The recorded scope changed; these baselines cannot be compared.");
  if (current.assessment?.id !== previous.assessment?.id || current.assessment?.catalogue_version_id !== previous.assessment?.catalogue_version_id) return incompatible("The assessment or catalogue changed; these baselines cannot be compared.");
  if (JSON.stringify(current.riskConfig) !== JSON.stringify(previous.riskConfig)) return incompatible("The risk method changed; these baselines cannot be compared.");
  const now = summariseBaseline(current); const before = summariseBaseline(previous);
  const metrics = [
    ["Open tasks", before.tasksOpen, now.tasksOpen], ["Overdue tasks", before.overdueTasks.length, now.overdueTasks.length],
    ["Notes awaiting review", before.pendingReviews.length, now.pendingReviews.length], ["Expired evidence", before.evidence.expired, now.evidence.expired],
    ["Unanswered questions", before.unanswered, now.unanswered],
  ] as const;
  return { comparable: true as const, reason: "Same objective, recorded scope, assessment catalogue and calculation basis. Changes in recorded work do not establish verified improvement.", changes: metrics.filter(([, old, value]) => old !== value).map(([label, old, value]) => `${label}: ${old} → ${value}`) };
}
