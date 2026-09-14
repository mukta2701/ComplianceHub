import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiSuggestionPanel } from "./ai-suggestion-panel";

describe("AiSuggestionPanel", () => {
  it("marks generation busy and announces the completed draft", async () => {
    let resolve: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const user = userEvent.setup();
    render(<AiSuggestionPanel target={{ targetType: "readiness_report" }} />);

    await user.click(screen.getByRole("button", { name: /draft explanation/i }));
    expect(screen.getByLabelText("AI Explain and Act")).toHaveAttribute("aria-busy", "true");
    resolve!({ ok: true, json: async () => ({ id: "draft-1", status: "draft", output: { explanation: "Draft explanation", recommendedAction: "Review the report", confidence: "medium" }, source_references: [] }) } as Response);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/draft explanation/i));
    expect(screen.getByLabelText("AI Explain and Act")).toHaveAttribute("aria-busy", "false");
  });

  it("recovers from a generation network failure without leaving the panel busy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const user = userEvent.setup();
    render(<AiSuggestionPanel target={{ targetType: "readiness_report" }} />);

    await user.click(screen.getByRole("button", { name: /draft explanation/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not generate/i));
    expect(screen.getByLabelText("AI Explain and Act")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: /draft explanation/i })).toBeEnabled();
  });

  it("records a human review without creating or changing a compliance record", async () => {
    let resolveReview: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "draft-1", status: "draft", output: { explanation: "Draft explanation", recommendedAction: "Review the report", confidence: "medium" }, source_references: [] }) } as Response)
      .mockImplementationOnce(() => new Promise<Response>((done) => { resolveReview = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AiSuggestionPanel target={{ targetType: "readiness_report" }} />);

    await user.click(screen.getByRole("button", { name: /draft explanation/i }));
    await screen.findByRole("button", { name: /mark draft reviewed/i });
    await user.click(screen.getByRole("button", { name: /mark draft reviewed/i }));

    expect(screen.getByLabelText("AI Explain and Act")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /dismiss draft/i })).toBeDisabled();
    resolveReview!({ ok: true, json: async () => ({ status: "accepted" }) } as Response);
    await waitFor(() => expect(screen.getByText(/draft accepted\. no compliance record was changed/i)).toBeVisible());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/app/ai/suggestions/draft-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "accepted" }) }));
  });
});
