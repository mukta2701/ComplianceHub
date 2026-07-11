import { describe, expect, it } from "vitest";
import {
  MAX_DASHBOARD_ACTIONS,
  prioritiseDashboardActions,
  type DashboardActionInput,
} from "./prioritise-actions";

function fixture(
  overrides: Partial<DashboardActionInput> & { kind: DashboardActionInput["kind"] },
): DashboardActionInput {
  return {
    id: overrides.id ?? `${overrides.kind}-${overrides.dueOn ?? "x"}`,
    kind: overrides.kind,
    label: overrides.label ?? "Action",
    explanation: overrides.explanation ?? "Explanation",
    destination: overrides.destination ?? "/app",
    source: overrides.source ?? "Test",
    dueOn: overrides.dueOn ?? null,
    owner: overrides.owner ?? null,
    severity: overrides.severity,
  };
}

describe("prioritiseDashboardActions", () => {
  it("orders blockers before reviews and ordinary due work", () => {
    const result = prioritiseDashboardActions(
      [
        fixture({ id: "a", kind: "approval", dueOn: "2026-07-10" }),
        fixture({ id: "b", kind: "soa_decision", severity: "blocker", dueOn: "2026-07-11" }),
        fixture({ id: "c", kind: "evidence_review", dueOn: "2026-07-10" }),
      ],
      "2026-07-10",
    );

    expect(result.map((item) => item.kind)).toEqual([
      "soa_decision",
      "evidence_review",
      "approval",
    ]);
  });

  it("ranks overdue work above upcoming work of the same kind", () => {
    const result = prioritiseDashboardActions(
      [
        fixture({ id: "future", kind: "task", dueOn: "2026-07-20" }),
        fixture({ id: "past", kind: "task", dueOn: "2026-07-01" }),
      ],
      "2026-07-10",
    );

    expect(result.map((item) => item.id)).toEqual(["past", "future"]);
  });

  it("breaks ties deterministically by id", () => {
    const result = prioritiseDashboardActions(
      [
        fixture({ id: "z", kind: "task", dueOn: "2026-07-10" }),
        fixture({ id: "a", kind: "task", dueOn: "2026-07-10" }),
      ],
      "2026-07-10",
    );

    expect(result.map((item) => item.id)).toEqual(["a", "z"]);
  });

  it("caps the queue at the maximum list length", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      fixture({ id: `t${index}`, kind: "task", dueOn: "2026-07-10" }),
    );

    expect(prioritiseDashboardActions(many, "2026-07-10")).toHaveLength(MAX_DASHBOARD_ACTIONS);
  });

  it("labels a blocker and computes overdue due context", () => {
    const [action] = prioritiseDashboardActions(
      [fixture({ id: "x", kind: "soa_decision", severity: "blocker", dueOn: "2026-07-05" })],
      "2026-07-10",
    );

    expect(action.priorityReason).toMatch(/block/i);
    expect(action.dueContext).toBe("Overdue");
  });

  it("describes upcoming work without a blocking reason", () => {
    const [action] = prioritiseDashboardActions(
      [fixture({ id: "x", kind: "task", dueOn: "2026-07-20" })],
      "2026-07-10",
    );

    expect(action.priorityReason).toBe("Scheduled");
    expect(action.dueContext).toBe("Due 2026-07-20");
  });
});
