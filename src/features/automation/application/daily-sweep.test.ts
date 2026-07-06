import { describe, expect, it } from "vitest";
import { runDailySweep, type SweepDependencies } from "./daily-sweep";

function makeDeps(overrides: Partial<SweepDependencies> = {}): SweepDependencies & {
  statusUpdates: [string, string][]; createdTasks: unknown[]; createdNotifications: { userId: string; kind: string }[];
} {
  const statusUpdates: [string, string][] = [];
  const createdTasks: unknown[] = [];
  const createdNotifications: { userId: string; kind: string }[] = [];
  return {
    statusUpdates, createdTasks, createdNotifications,
    today: "2026-07-02",
    listActiveEvidence: async () => [
      { id: "e1", organisationId: "org1", title: "Backup report", ownerId: "u1", status: "current", validUntil: "2026-07-20" },
      { id: "e2", organisationId: "org1", title: "Old cert", ownerId: null, status: "expiring", validUntil: "2026-06-01" },
    ],
    updateEvidenceStatus: async (id, status) => { statusUpdates.push([id, status]); },
    listOpenExpiryTaskEvidenceIds: async () => ["e1"],
    createTask: async (task) => { createdTasks.push(task); return true; },
    listOverdueTasks: async () => [
      { id: "t1", organisationId: "org1", title: "Fix firewall", ownerId: "u1", status: "open", dueOn: "2026-07-01" },
      { id: "t2", organisationId: "org1", title: "Unowned", ownerId: null, status: "open", dueOn: "2026-07-01" },
    ],
    listReviewablePolicies: async () => [],
    listOpenPolicyReviewTaskPolicyIds: async () => [],
    createPolicyReviewTask: async (task) => { createdTasks.push(task); return true; },
    listOrganisationOwners: async () => ["owner1"],
    createNotification: async (notification) => { createdNotifications.push({ userId: notification.userId, kind: notification.kind }); return true; },
    ...overrides,
  };
}

describe("runDailySweep", () => {
  it("applies transitions, raises expiry tasks, and notifies owners (falling back to org owners)", async () => {
    const deps = makeDeps();
    const summary = await runDailySweep(deps);
    expect(deps.statusUpdates).toEqual([["e1", "expiring"], ["e2", "expired"]]);
    expect(deps.createdTasks).toHaveLength(1);
    expect(deps.createdNotifications).toEqual([
      { userId: "u1", kind: "evidence_expiring" },   // e1 transition -> owner
      { userId: "owner1", kind: "evidence_expired" }, // e2 has no owner -> org owners
      { userId: "u1", kind: "task_overdue" },
      { userId: "owner1", kind: "task_overdue" },     // unowned task -> org owners
    ]);
    expect(summary).toEqual({ evidenceExpiring: 1, evidenceExpired: 1, tasksCreated: 1, notificationsCreated: 4 });
  });

  it("raises a task and notification for evidence already marked expired", async () => {
    const deps = makeDeps({
      listActiveEvidence: async () => [
        { id: "e3", organisationId: "org1", title: "Uploaded stale cert", ownerId: "u1", status: "expired", validUntil: "2026-07-01" },
      ],
      listOpenExpiryTaskEvidenceIds: async () => [],
      listOverdueTasks: async () => [],
    });
    const summary = await runDailySweep(deps);
    expect(deps.statusUpdates).toEqual([]);
    expect(deps.createdTasks).toHaveLength(1);
    expect(deps.createdNotifications).toEqual([{ userId: "u1", kind: "evidence_expired" }]);
    expect(summary).toEqual({ evidenceExpiring: 0, evidenceExpired: 0, tasksCreated: 1, notificationsCreated: 1 });
  });

  it("does not re-raise work for expired evidence whose task already exists", async () => {
    // Regression lock for the no-daily-re-raise contract: evidence that is
    // already `expired` and whose expiry task was completed-without-replacement.
    // The task's `done` state means it is absent from the open-expiry set, so a
    // task is planned again — but createTask hits the
    // (organisation_id, evidence_id, source) unique constraint and returns false
    // (upsert ignoreDuplicates), and the expired-evidence notification is gated
    // on that. Result: zero new tasks and zero notifications, day after day.
    const deps = makeDeps({
      listActiveEvidence: async () => [
        { id: "e3", organisationId: "org1", title: "Uploaded stale cert", ownerId: "u1", status: "expired", validUntil: "2026-07-01" },
      ],
      listOpenExpiryTaskEvidenceIds: async () => [], // prior expiry task is `done`, not open
      createTask: async () => false, // upsert conflicts with the existing done task
      listOverdueTasks: async () => [],
    });
    const summary = await runDailySweep(deps);
    expect(deps.statusUpdates).toEqual([]);
    expect(deps.createdNotifications).toEqual([]);
    expect(summary).toEqual({ evidenceExpiring: 0, evidenceExpired: 0, tasksCreated: 0, notificationsCreated: 0 });
  });

  it("raises a review task and notifies the owner for a policy that is due, ignoring future ones", async () => {
    const deps = makeDeps({
      listActiveEvidence: async () => [],
      listOverdueTasks: async () => [],
      listReviewablePolicies: async () => [
        { id: "p1", organisationId: "org1", reference: "POL-001", title: "Access control", ownerId: "u1", reviewDue: "2026-07-01" },
        { id: "p2", organisationId: "org1", reference: "POL-002", title: "Cryptography", ownerId: null, reviewDue: "2026-07-02" },
        { id: "p3", organisationId: "org1", reference: "POL-003", title: "Not yet due", ownerId: "u1", reviewDue: "2026-08-01" },
      ],
    });
    const summary = await runDailySweep(deps);
    expect(deps.createdTasks).toEqual([
      { organisationId: "org1", policyId: "p1", reference: "POL-001", title: "Access control", ownerId: "u1", dueOn: "2026-07-01" },
      { organisationId: "org1", policyId: "p2", reference: "POL-002", title: "Cryptography", ownerId: null, dueOn: "2026-07-02" },
    ]);
    expect(deps.createdNotifications).toEqual([
      { userId: "u1", kind: "policy_review" },       // owned policy -> owner
      { userId: "owner1", kind: "policy_review" },    // unowned policy -> org owners
    ]);
    expect(summary).toEqual({ evidenceExpiring: 0, evidenceExpired: 0, tasksCreated: 2, notificationsCreated: 2 });
  });

  it("does not re-raise a review task for a policy that already has an open policy_review task", async () => {
    const deps = makeDeps({
      listActiveEvidence: async () => [],
      listOverdueTasks: async () => [],
      listReviewablePolicies: async () => [
        { id: "p1", organisationId: "org1", reference: "POL-001", title: "Access control", ownerId: "u1", reviewDue: "2026-07-01" },
      ],
      listOpenPolicyReviewTaskPolicyIds: async () => ["p1"], // an open review task already covers it
    });
    const summary = await runDailySweep(deps);
    expect(deps.createdTasks).toEqual([]);
    expect(deps.createdNotifications).toEqual([]);
    expect(summary).toEqual({ evidenceExpiring: 0, evidenceExpired: 0, tasksCreated: 0, notificationsCreated: 0 });
  });
});
