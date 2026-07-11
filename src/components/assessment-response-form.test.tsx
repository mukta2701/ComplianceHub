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
});
