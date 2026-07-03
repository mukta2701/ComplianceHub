import { describe, expect, it } from "vitest";
import { isOverdue, nextDueDate, suggestTasksFromGaps } from "./tasks";

describe("nextDueDate", () => {
  it("advances by each supported recurrence interval", () => {
    expect(nextDueDate("2026-07-02", "weekly")).toBe("2026-07-09");
    expect(nextDueDate("2026-07-02", "monthly")).toBe("2026-08-02");
    expect(nextDueDate("2026-07-02", "quarterly")).toBe("2026-10-02");
    expect(nextDueDate("2026-07-02", "semiannually")).toBe("2027-01-02");
    expect(nextDueDate("2026-07-02", "annually")).toBe("2027-07-02");
  });
  it("clamps to the last day of shorter months", () => {
    expect(nextDueDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDueDate("2026-08-31", "monthly")).toBe("2026-09-30");
  });
  it("crosses year boundaries for weekly recurrence", () => {
    expect(nextDueDate("2026-12-28", "weekly")).toBe("2027-01-04");
  });
  it("rejects non-ISO dates", () => {
    expect(() => nextDueDate("02/07/2026", "weekly")).toThrow(/ISO date/);
  });
});

describe("isOverdue", () => {
  it("flags only actionable tasks with a past due date", () => {
    expect(isOverdue({ status: "open", dueOn: "2026-07-01" }, "2026-07-02")).toBe(true);
    expect(isOverdue({ status: "in_progress", dueOn: "2026-07-01" }, "2026-07-02")).toBe(true);
    expect(isOverdue({ status: "open", dueOn: "2026-07-02" }, "2026-07-02")).toBe(false);
    expect(isOverdue({ status: "done", dueOn: "2026-07-01" }, "2026-07-02")).toBe(false);
    expect(isOverdue({ status: "open", dueOn: null }, "2026-07-02")).toBe(false);
  });
});

describe("suggestTasksFromGaps", () => {
  it("turns gaps into pre-filled task suggestions without persisting", () => {
    const suggestions = suggestTasksFromGaps([
      { questionId: "q1", category: "Access control", prompt: "Access reviews happen", remediation: "Establish access reviews" },
    ]);
    expect(suggestions).toEqual([
      { sourceQuestionId: "q1", title: "Close gap: Access reviews happen", detail: "Establish access reviews", source: "gap" },
    ]);
  });
});
