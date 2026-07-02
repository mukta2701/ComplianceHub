import { describe, expect, it, vi } from "vitest";
import { AssessmentRevisionConflictError, saveAssessmentResponse } from "./autosave";

describe("assessment autosave", () => {
  const input = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    questionId: "00000000-0000-4000-8000-000000000002",
    answer: "partially" as const,
    evidenceNote: "Policy drafted",
    expectedRevision: 4,
  };

  it("returns the new revision from the atomic save operation", async () => {
    const save = vi.fn().mockResolvedValue({ revision: 5 });
    await expect(saveAssessmentResponse(input, { save })).resolves.toEqual({ revision: 5 });
    expect(save).toHaveBeenCalledWith(input);
  });

  it("turns a database serialization conflict into a typed conflict", async () => {
    const save = vi.fn().mockRejectedValue({ code: "40001", message: "assessment revision conflict" });
    await expect(saveAssessmentResponse(input, { save })).rejects.toBeInstanceOf(AssessmentRevisionConflictError);
  });

  it("validates evidence length before persistence", async () => {
    const save = vi.fn();
    await expect(saveAssessmentResponse({ ...input, evidenceNote: "x".repeat(10_001) }, { save })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
