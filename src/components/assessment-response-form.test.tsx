import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentResponseList } from "./assessment-response-form";

afterEach(() => vi.restoreAllMocks());

const props = {
  sessionId: "s1", initialRevision: 1,
  questions: [{ id: "q1", code: "A.5.1", prompt: "Policy exists?" }],
  responses: [{ question_id: "q1", answer: null, evidence_note: "" }],
};

describe("AssessmentResponseList autosave recovery", () => {
  it("recovers after a failed save instead of wedging", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 2 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);
    const select = screen.getByRole("combobox");
    await userEvent.selectOptions(select, "yes");   // first save -> rejects
    await waitFor(() => expect(screen.getByText("save failed")).toBeInTheDocument());
    await userEvent.selectOptions(select, "no");    // second save -> must still run
    await waitFor(() => expect(screen.getByText("saved")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
