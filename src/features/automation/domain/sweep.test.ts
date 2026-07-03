import { describe, expect, it } from "vitest";
import { planEvidenceTransitions, planExpiryTasks, planOverdueTaskAlerts } from "./sweep";

const evidence = (over: Partial<Parameters<typeof planEvidenceTransitions>[0][number]>) => ({
  id: "e1", organisationId: "org1", title: "Backup report", ownerId: "u1", status: "current" as const, validUntil: "2026-07-20", ...over,
});

describe("planEvidenceTransitions", () => {
  it("moves evidence into expiring and expired as dates pass, and is idempotent", () => {
    expect(planEvidenceTransitions([evidence({})], "2026-07-02")).toEqual([
      { evidenceId: "e1", organisationId: "org1", title: "Backup report", ownerId: "u1", to: "expiring" },
    ]);
    expect(planEvidenceTransitions([evidence({ status: "expiring" })], "2026-07-02")).toEqual([]);
    expect(planEvidenceTransitions([evidence({ status: "expiring", validUntil: "2026-07-01" })], "2026-07-02")).toEqual([
      { evidenceId: "e1", organisationId: "org1", title: "Backup report", ownerId: "u1", to: "expired" },
    ]);
  });
  it("ignores evidence without an expiry date", () => {
    expect(planEvidenceTransitions([evidence({ validUntil: null })], "2026-07-02")).toEqual([]);
  });
});

describe("planExpiryTasks", () => {
  it("creates one linked task per stale evidence item lacking an open expiry task", () => {
    const items = [evidence({}), evidence({ id: "e2", title: "Old cert", status: "expiring", validUntil: "2026-06-01" })];
    expect(planExpiryTasks(items, ["e1"], "2026-07-02")).toEqual([
      { organisationId: "org1", evidenceId: "e2", title: "Replace stale evidence: Old cert", ownerId: "u1", dueOn: "2026-06-01" },
    ]);
  });
  it("creates nothing when evidence is fresh or already has an open task", () => {
    expect(planExpiryTasks([evidence({ validUntil: "2026-12-01" })], [], "2026-07-02")).toEqual([]);
    expect(planExpiryTasks([evidence({})], ["e1"], "2026-07-02")).toEqual([]);
  });
});

describe("planOverdueTaskAlerts", () => {
  it("alerts on actionable overdue tasks only", () => {
    const tasks = [
      { id: "t1", organisationId: "org1", title: "Fix firewall", ownerId: "u1", status: "open" as const, dueOn: "2026-07-01" },
      { id: "t2", organisationId: "org1", title: "Done already", ownerId: "u1", status: "done" as const, dueOn: "2026-07-01" },
      { id: "t3", organisationId: "org1", title: "No date", ownerId: null, status: "open" as const, dueOn: null },
    ];
    expect(planOverdueTaskAlerts(tasks, "2026-07-02")).toEqual([
      { organisationId: "org1", taskId: "t1", title: "Fix firewall", ownerId: "u1" },
    ]);
  });
});
