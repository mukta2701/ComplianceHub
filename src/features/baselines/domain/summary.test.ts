import { describe, expect, it } from "vitest";
import { summariseBaseline, compareBaselines, type BaselinePayload } from "./summary";
const base: BaselinePayload = {
  schemaVersion: 1, calculationVersion: 1, organisationId: "org", organisationName: "Example", objective: "Start readiness", savedAt: "2026-09-09T12:00:00Z", progressRevision: 1,
  scope: null, assessment: null, questions: [], tasks: [], contributions: [], evidence: [], risks: [], riskConfig: null,
};
describe("saved baseline explanation", () => {
  it("keeps all six missing scope fields and absent assessment explicit", () => {
    const result = summariseBaseline(base);
    expect(result.scopeGaps).toHaveLength(6);
    expect(result.limitations).toContain("No assessment was selected.");
    expect(result.limitations).toContain("No active evidence records were captured.");
    expect(result.partial).toBe(true);
  });
  it("counts unanswered catalogue questions and answered gaps without manufacturing a score", () => {
    const result = summariseBaseline({ ...base, assessment: { id: "a", title: "Readiness", revision: 3, catalogue_version_id: "c", catalogue_version: "v1", updated_at: "2026-09-09" }, questions: [
      { id: "q1", prompt: "Backups?", answer: null, evidence_note: "", updated_at: null },
      { id: "q2", prompt: "Access?", answer: "no", evidence_note: "", updated_at: "2026-09-09" },
    ] });
    expect(result.unanswered).toBe(1); expect(result.assessmentGaps).toHaveLength(2); expect(result.missingAnswerEvidence).toBe(1);
    expect(result).not.toHaveProperty("score");
  });
  it("derives expiry at saved date and preserves terminal statuses", () => {
    const result = summariseBaseline({ ...base, evidence: [
      { id: "e1", title: "Expired", kind: "note", description: "", status: "current", valid_until: "2026-09-08", collected_on: "2026-09-01", created_at: "2026-09-01" },
      { id: "e2", title: "Withdrawn", kind: "note", description: "", status: "withdrawn", valid_until: null, collected_on: "2026-09-01", created_at: "2026-09-01" },
    ] });
    expect(result.evidence).toEqual({ total: 1, expiring: 0, expired: 1 });
    expect(result.evidenceItems[1].status).toBe("withdrawn");
  });
  it("does not upgrade explicitly stale evidence when its validity date is missing", () => {
    const result = summariseBaseline({ ...base, evidence: [{ id: "stale", title: "Stale proof", kind: "note", description: "", status: "expired", valid_until: null, collected_on: "2026-09-01", created_at: "2026-09-01" }] });
    expect(result.evidence.expired).toBe(1);
  });
  it("keeps done work distinct from evidence acceptance and ignores stale pending assignments", () => {
    const task = { id: "t", title: "Restore", status: "done", owner_id: null, owner_name: null, due_on: "2026-09-01", updated_at: "2026-09-09", assignment_revision: 2 };
    const review = { submitter_id: "owner", submitter_name: "Alex", reviewer_id: null, reviewer_name: null, id: "c", task_id: "t", assignment_revision: 1, decision: "pending" as const, note: "Restore", rationale: null, evidence_id: null, created_at: "2026-09-09", reviewed_at: null };
    const result = summariseBaseline({ ...base, tasks: [task], contributions: [review] });
    expect(result.tasksOpen).toBe(0); expect(result.pendingReviews).toHaveLength(0); expect(result.obsoletePendingReviews).toHaveLength(1);
    expect(result.limitations.join(" ")).toMatch(/does not verify/);
  });
  it("requires the current owner to match the pending submitter", () => {
    const task = { id: "t", title: "Restore", status: "open", owner_id: "new-owner", owner_name: "New owner", due_on: null, updated_at: "2026-09-09", assignment_revision: 2 };
    const review = { id: "c", task_id: "t", assignment_revision: 2, submitter_id: "old-owner", submitter_name: "Old owner", reviewer_id: null, reviewer_name: null, decision: "pending" as const, note: "Restore", rationale: null, evidence_id: null, created_at: "2026-09-09", reviewed_at: null };
    expect(summariseBaseline({ ...base, tasks: [task], contributions: [review] }).pendingReviews).toHaveLength(0);
  });
  it("uses saved configured risk thresholds and residual ratings", () => {
    const result = summariseBaseline({ ...base, riskConfig: { low_max: 2, moderate_max: 4, high_max: 8, appetite_threshold: 6 }, risks: [{ id: "r", reference: "R1", title: "Restore risk", status: "treating", residual_likelihood: 3, residual_impact: 3, owner_id: null, owner_name: null, review_date: null, updated_at: "2026-09-09" }] });
    expect(result.risks[0]).toMatchObject({ band: "very_high", exceedsAppetite: true });
  });
  it("compares only same objective, scope, assessment and calculation basis", () => {
    expect(compareBaselines(base, null).reason).toMatch(/No previous/);
    expect(compareBaselines(base, { ...base, objective: "Different" }).reason).toMatch(/objective/);
    expect(compareBaselines(base, { ...base, scope: { scope_statement: "Changed", services: "", locations: "", information_types: "", dependencies: "", exclusions: "", updated_at: "today" } }).reason).toMatch(/scope/);
    expect(compareBaselines(base, { ...base, calculationVersion: 2 }).reason).toMatch(/calculation/);
    expect(compareBaselines(base, { ...base, savedAt: "2026-09-08T12:00:00Z" }).comparable).toBe(true);
  });
});
