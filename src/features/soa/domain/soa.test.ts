import { describe, expect, it } from "vitest";
import { createSoaDraft, createSoaSnapshot } from "./soa";

describe("createSoaDraft", () => {
  it("suggests statuses from assessment answers and leaves decisions reviewable", () => {
    const draft = createSoaDraft("assessment-1", [
      { questionId: "q1", answer: "yes" as const },
      { questionId: "q2", answer: "partially" as const },
      { questionId: "q3", answer: "no" as const },
      { questionId: "q4", answer: "not_applicable" as const },
    ]);
    expect(draft.items.map((item) => item.suggestedStatus)).toEqual([
      "operational", "in_progress", "pending", "not_applicable",
    ]);
    expect(draft.items.every((item) => item.reviewed === false)).toBe(true);
  });
});

describe("createSoaSnapshot", () => {
  it("deep-copies and freezes finalised snapshot data", () => {
    const draft = createSoaDraft("assessment-1", [{ questionId: "q1", answer: "yes" }]);
    draft.items[0].justification = "Evidence reviewed";
    const snapshot = createSoaSnapshot(draft, { version: 1, finalisedAt: "2026-07-02T00:00:00Z", finalisedBy: "user-1" });
    draft.items[0].justification = "Changed later";
    expect(snapshot.items[0].justification).toBe("Evidence reviewed");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.items[0])).toBe(true);
  });
});
