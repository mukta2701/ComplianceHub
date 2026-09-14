import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentResponseList } from "./assessment-response-form";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

afterEach(() => vi.restoreAllMocks());
beforeEach(() => navigation.push.mockReset());

const questions = [
  { id: "q1", code: "GOV-01", prompt: "Have leaders approved security objectives?", position: 0, categoryCode: "GOV", categoryTitle: "Governance and leadership", categoryPosition: 0 },
  { id: "q2", code: "GOV-02", prompt: "Are security responsibilities understood?", position: 1, categoryCode: "GOV", categoryTitle: "Governance and leadership", categoryPosition: 0 },
  { id: "q3", code: "RISK-01", prompt: "Are risks assessed consistently?", position: 0, categoryCode: "RISK", categoryTitle: "Risk management", categoryPosition: 1 },
];

const props = {
  sessionId: "s1",
  initialRevision: 1,
  questions,
  responses: [
    { question_id: "q1", answer: null, evidence_note: "" },
    { question_id: "q2", answer: null, evidence_note: "" },
    { question_id: "q3", answer: null, evidence_note: "" },
  ],
};

function ok(revision: number) {
  return { ok: true, status: 200, json: async () => ({ revision }) } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("AssessmentResponseList guided flow", () => {
  it("lets a read-only Member browse answers without changing or saving them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} readOnly />);
    expect(screen.getByRole("radio", { name: "Yes" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Evidence note" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByRole("heading", { name: /GOV-02/ })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("renders one active question with guidance, section outline, and progress", () => {
    render(<AssessmentResponseList {...props} />);

    expect(screen.getByRole("heading", { name: /GOV-01.*leaders approved/i })).toBeVisible();
    expect(screen.queryByText(/GOV-02.*responsibilities/i)).not.toBeInTheDocument();
    expect(screen.getByText("Question 1 of 3")).toBeVisible();
    expect(screen.getByText("Question 1 of 2 in this section")).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Assessment sections" })).toHaveTextContent("Governance and leadership2 questionsRisk management1 question");
    expect(screen.getByRole("heading", { name: "Why it matters" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "A practical startup baseline" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Suggested evidence examples" }).children.length).toBeGreaterThan(0);
  });

  it.each([
    ["Yes", "in place"],
    ["Partially", "follow-up"],
    ["No", "gap"],
    ["Not applicable", "reason"],
  ])("explains the consequence of choosing %s", async (answer, consequence) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(2)));
    render(<AssessmentResponseList {...props} />);

    await userEvent.click(screen.getByRole("radio", { name: answer }));

    expect(screen.getByRole("status", { name: "Answer consequence" })).toHaveTextContent(new RegExp(consequence, "i"));
    expect(screen.getByRole("heading", { name: /GOV-01/ })).toBeVisible();
  });

  it("retains controlled answer and unblurred evidence across previous and next navigation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(2)));
    render(<AssessmentResponseList {...props} />);

    await userEvent.click(screen.getByRole("radio", { name: "Partially" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Evidence note" }), "Draft policy approval");
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("heading", { name: /GOV-02/ });
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(screen.getByRole("radio", { name: "Partially" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Evidence note" })).toHaveValue("Draft policy approval");
  });

  it("serialises saves and propagates the session-wide revision", async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ok(3));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);

    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ answer: "yes", expectedRevision: 1 });

    first.resolve(ok(2));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ answer: "no", expectedRevision: 2 });
  });

  it("advances only after persistence and avoids a duplicate save for the same snapshot", async () => {
    const save = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(save.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);

    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(screen.getByRole("heading", { name: /GOV-01/ })).toBeVisible();

    save.resolve(ok(2));
    await screen.findByRole("heading", { name: /GOV-02/ });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flushes before finishing later", async () => {
    const save = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(save.promise));
    render(<AssessmentResponseList {...props} />);

    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    expect(navigation.push).not.toHaveBeenCalled();
    save.resolve(ok(2));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app/assessment"));
  });

  it("recovers after a network failure and exposes Failed and Saved in a live region", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(ok(2));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);

    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Failed"));
    await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saved"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps conflicts visible and blocks stale saves and advancement", async () => {
    const save = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(save.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);

    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    save.resolve({ ok: false, status: 409, json: async () => ({ error: "conflict" }) } as Response);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Conflict.*reload/i));
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: /GOV-01/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload assessment" })).toBeVisible();
  });

  it("prevents an evidence-only save when no answer is selected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);

    const evidence = screen.getByRole("textbox", { name: "Evidence note" });
    await userEvent.type(evidence, "Some notes");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/choose an answer/i);
    expect(screen.getByRole("heading", { name: /GOV-01/ })).toBeVisible();
  });

  it("supports arrow-key radio selection and moves focus to the next question heading", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(2)));
    render(<AssessmentResponseList {...props} />);

    const group = screen.getByRole("radiogroup", { name: "Your answer" });
    const yes = within(group).getByRole("radio", { name: "Yes" });
    yes.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(group).getByRole("radio", { name: "Partially" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    const nextHeading = await screen.findByRole("heading", { name: /GOV-02/ });
    expect(nextHeading).toHaveFocus();
    expect(screen.getByRole("status", { name: "Question progress announcement" })).toHaveTextContent("Question 2 of 3");
  });

  it("announces Saving then Saved without moving focus", async () => {
    const save = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(save.promise));
    render(<AssessmentResponseList {...props} />);
    const yes = screen.getByRole("radio", { name: "Yes" });

    await userEvent.click(yes);
    expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saving");
    expect(yes).toHaveFocus();
    save.resolve(ok(2));

    await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saved"));
    expect(yes).toHaveFocus();
  });

  it("does not drop a newer draft when an earlier queued save fails", async () => {
    const firstSave = deferred<Response>();
    const secondSave = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);

    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    const evidence = screen.getByRole("textbox", { name: "Evidence note" });
    await userEvent.type(evidence, "Updated evidence");
    await userEvent.tab();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    firstSave.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    secondSave.resolve(ok(3));

    await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saved"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

});

describe("assessment completion", () => {
  const singleQuestionProps = { ...props, questions: [questions[0]], responses: [] };
  const answeredProps = { ...props, questions: questions.slice(0, 2), responses: [
    { question_id: "q1", answer: "yes", evidence_note: "" },
    { question_id: "q2", answer: "yes", evidence_note: "" },
  ] };

  it("persists a reverted earlier answer before advancing and completing", async () => {
    const noSave = deferred<Response>();
    const yesSave = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(noSave.promise).mockReturnValueOnce(yesSave.promise).mockResolvedValueOnce(ok(3));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...answeredProps} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(screen.getByRole("heading", { name: /GOV-01/ })).toBeVisible();
    noSave.resolve(ok(2));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ questionId: "q1", answer: "yes", expectedRevision: 2 });
    expect(screen.getByRole("heading", { name: /GOV-01/ })).toBeVisible();
    yesSave.resolve(ok(3));
    await screen.findByRole("heading", { name: /GOV-02/ });
    await userEvent.click(screen.getByRole("button", { name: "Save and complete" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app/assessment/s1?completed=1"));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/app/assessment/complete");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ sessionId: "s1", expectedRevision: 3 });
  });

  it("keeps a repeated answer after an intervening queued answer", async () => {
    const firstSave = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce(ok(3)).mockResolvedValueOnce(ok(4));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    firstSave.resolve(ok(2));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { sessionId: "s1", questionId: "q1", answer: "yes", evidenceNote: "", expectedRevision: 1 },
      { sessionId: "s1", questionId: "q1", answer: "no", evidenceNote: "", expectedRevision: 2 },
      { sessionId: "s1", questionId: "q1", answer: "yes", evidenceNote: "", expectedRevision: 3 },
    ]);
    expect(screen.getByRole("radio", { name: "Yes" })).toBeChecked();
  });

  it.each(["saved", "failed", "conflict"])("reconciles an earlier draft before completion when its retry is %s", async (result) => {
    const noSave = deferred<Response>();
    const yesSave = deferred<Response>();
    const retrySave = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(noSave.promise).mockReturnValueOnce(yesSave.promise)
      .mockReturnValueOnce(retrySave.promise).mockResolvedValueOnce(ok(3));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...answeredProps} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    noSave.resolve(ok(2));
    await screen.findByRole("heading", { name: /GOV-02/ });
    await userEvent.click(screen.getByRole("button", { name: "Save and complete" }));
    yesSave.resolve({ ok: false, status: 500 } as Response);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/app/assessment/response");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ questionId: "q1", answer: "yes", expectedRevision: 2 });
    expect(navigation.push).not.toHaveBeenCalled();
    retrySave.resolve(result === "saved" ? ok(3) : { ok: false, status: result === "conflict" ? 409 : 500 } as Response);
    if (result === "saved") {
      await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app/assessment/s1?completed=1"));
      expect(fetchMock.mock.calls[3][0]).toBe("/api/app/assessment/complete");
      expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ sessionId: "s1", expectedRevision: 3 });
    } else {
      await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent(result === "conflict" ? "Conflict" : "Failed"));
      expect(navigation.push).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.every(([url]) => url === "/api/app/assessment/response")).toBe(true);
      if (result === "conflict") {
        await userEvent.click(screen.getByRole("button", { name: "Save and complete" }));
        expect(fetchMock).toHaveBeenCalledTimes(3);
      }
    }
  });

  it("waits for the final answer save and completion before navigating", async () => {
    const save = deferred<Response>();
    const complete = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(save.promise).mockReturnValueOnce(complete.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...singleQuestionProps} />);
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and complete" }));
    expect(navigation.push).not.toHaveBeenCalled();
    save.resolve(ok(2));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/app/assessment/complete");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ sessionId: "s1", expectedRevision: 2 });
    expect(navigation.push).not.toHaveBeenCalled();
    complete.resolve({ ok: true, status: 200, json: async () => ({ revision: 2, state: "completed" }) } as Response);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app/assessment/s1?completed=1"));
  });
  it("keeps the draft on screen when completion fails and allows retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(2))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "Could not complete the assessment. Please retry." }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revision: 2, state: "completed" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...singleQuestionProps} />);
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and complete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not complete");
    expect(navigation.push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save and complete" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app/assessment/s1?completed=1"));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/app/assessment/response")).toHaveLength(1);
  });
  it("keeps finish-later as a draft operation even on the last question", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(2));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...singleQuestionProps} />);
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app/assessment"));
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/app/assessment/response")).toBe(true);
  });
});


describe("assessment restored draft actions", () => {
  it.each(["task", "risk"])("saves before opening a reviewed %s draft with its source", async (kind) => {
    const saved = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(saved.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: `Review ${kind} draft` }));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Yes" })).toBeDisabled();
    saved.resolve(ok(2));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    const destination = new URL(navigation.push.mock.calls[0][0], "http://localhost");
    expect(destination.pathname).toBe(kind === "task" ? "/app/tasks/from-gap" : "/app/risks/new");
    expect(destination.searchParams.get(kind === "task" ? "questionId" : "sourceAssessmentSessionId")).toBe(kind === "task" ? "q1" : "s1");
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/app/assessment/response")).toBe(true);
  });
  it.each([500, 409])("blocks draft navigation after save error %s", async (status) => {
    const saved = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(saved.promise));
    render(<AssessmentResponseList {...props} />);
    await userEvent.click(screen.getByRole("radio", { name: "Partially" }));
    await userEvent.click(screen.getByRole("button", { name: "Review task draft" }));
    saved.resolve({ ok: false, status } as Response);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Yes" })).toBeEnabled());
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent(status === 409 ? "Conflict" : "Failed");
  });
  it("uses the saved question and session for optional AI, with no automatic compliance write", async () => {
    const saved = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(saved.promise).mockResolvedValueOnce({ ok: true, json: async () => ({
      id: "suggestion", status: "draft", output: { explanation: "Review this gap", recommendedAction: "Assign an owner", confidence: "medium" }, source_references: [],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} aiEnabled />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(screen.queryByRole("button", { name: "Draft explanation and next step" })).not.toBeInTheDocument();
    saved.resolve(ok(2));
    await userEvent.click(await screen.findByRole("button", { name: "Draft explanation and next step" }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ targetType: "assessment_question", targetId: "q1", sessionId: "s1" });
    expect(await screen.findByRole("button", { name: "Mark draft reviewed" })).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Why it matters" })).toBeVisible();
  });
  it("keeps draft and AI authoring absent in read-only assessments even when enabled", () => {
    render(<AssessmentResponseList {...props} aiEnabled readOnly responses={[{ question_id: "q1", answer: "no", evidence_note: "" }]} />);
    expect(screen.queryByRole("button", { name: /Review (task|risk) draft/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft explanation and next step" })).not.toBeInTheDocument();
  });
});

describe("assessment reverted-save status recovery", () => {
  const savedNo = { ...props, responses: questions.map((question) => ({ question_id: question.id, answer: "no", evidence_note: "" })) };
  it.each([true, false])("recovers a saved answer reverted before failure=%s without another PATCH", async (revertBeforeFailure) => {
    const request = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(request.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...savedNo} aiEnabled />);
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    if (revertBeforeFailure) await userEvent.click(screen.getByRole("radio", { name: "No" }));
    request.resolve({ ok: false, status: 500 } as Response);
    if (!revertBeforeFailure) {
      await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Failed"));
      await userEvent.click(screen.getByRole("radio", { name: "No" }));
    }
    await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saved"));
    expect(screen.queryByRole("button", { name: "Retry save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft explanation and next step" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not clear a different question's unsaved failure when a reverted answer is already saved", async () => {
    const request = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockReturnValueOnce(request.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...savedNo} aiEnabled />);
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("heading", { name: /GOV-02/ });
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Failed"));
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    request.resolve({ ok: false, status: 500 } as Response);
    await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Failed"));
    await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Failed");
    expect(screen.queryByRole("button", { name: "Draft explanation and next step" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("never clears a revision conflict when the selected answer matches its last saved value", async () => {
    const request = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(request.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...savedNo} aiEnabled />);
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    request.resolve({ ok: false, status: 409 } as Response);
    await waitFor(() => expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Conflict"));
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Conflict");
    expect(screen.getByRole("heading", { name: /GOV-01/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Draft explanation and next step" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
