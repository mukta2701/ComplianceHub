import { describe, expect, it } from "vitest";
import { contributionInputSchema, reviewInputSchema, contributionPermissions, contributionTime } from "./contributions";
const id = "97000000-0000-4000-8000-000000000001";
describe("task contribution input", () => {
  it("keeps a bounded immutable note and exact assignment revision", () => {
    expect(contributionInputSchema.parse({ taskId: id, requestId: id, assignmentRevision: "3", note: "  Restore demonstrated. Source: https://example.test  " })).toEqual({ taskId: id, requestId: id, assignmentRevision: 3, note: "Restore demonstrated. Source: https://example.test" });
  });
  it.each(["", " ", "x".repeat(10001)])("rejects missing or oversized notes", (note) => {
    expect(contributionInputSchema.safeParse({ taskId: id, requestId: id, assignmentRevision: "0", note }).success).toBe(false);
  });
  it.each(["-1", "1.5", "", "9007199254740992"])("rejects invalid assignment revision %s", (assignmentRevision) => {
    expect(contributionInputSchema.safeParse({ taskId: id, requestId: id, assignmentRevision, note: "Proof" }).success).toBe(false);
  });
  it("requires a rationale for both decisions", () => {
    for (const decision of ["accepted", "changes_requested"]) expect(reviewInputSchema.safeParse({ taskId: id, contributionId: id, requestId: id, decision, rationale: " " }).success).toBe(false);
  });
});
describe("contribution visibility", () => {
  const base = { userId: "assignee", ownerId: "assignee", role: "member", status: "open", assignmentRevision: 2, contributions: [] };
  it("offers submission only to the current assignee on active work", () => {
    expect(contributionPermissions(base).canSubmit).toBe(true);
    expect(contributionPermissions({ ...base, userId: "other" }).canSubmit).toBe(false);
    expect(contributionPermissions({ ...base, status: "done" }).canSubmit).toBe(false);
  });
  it("ignores obsolete pending work while preventing duplicate current submissions", () => {
    expect(contributionPermissions({ ...base, contributions: [{ id, submitter_id: "assignee", assignment_revision: 1, decision: "pending" }] }).canSubmit).toBe(true);
    expect(contributionPermissions({ ...base, contributions: [{ id, submitter_id: "assignee", assignment_revision: 2, decision: "pending" }] }).canSubmit).toBe(false);
  });
  it("allows only an independent operator to review the active version", () => {
    const contributions = [{ id, submitter_id: "assignee", assignment_revision: 2, decision: "pending" }];
    expect(contributionPermissions({ ...base, contributions, userId: "reviewer", role: "admin" }).reviewableIds).toEqual([id]);
    expect(contributionPermissions({ ...base, contributions, role: "owner" }).reviewableIds).toEqual([]);
    expect(contributionPermissions({ ...base, contributions, userId: "other" }).reviewableIds).toEqual([]);
  });
});

describe("contribution dates", () => {
  it("shows a readable timestamp in explicitly fixed UTC", () => {
    expect(contributionTime("2026-09-09T15:36:15.000Z")).toBe("9 Sep 2026, 15:36 UTC");
  });
});
