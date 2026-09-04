import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ status: "completed", role: "owner" }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org" }, membership: { role: state.role },
  supabase: { from: (table: string) => {
    const rows: Record<string, unknown[]> = {
      ai_workspace_settings: [{ enabled: false }],
      assessment_sessions: [{ id: "session", title: "Review", state: state.status, revision: 2, catalogue_version_id: "catalogue" }],
      catalogue_categories: [{ id: "category", code: "GOV", title: "Governance", position: 0 }],
      catalogue_questions: [{ id: "question", category_id: "category", code: "GOV-01", prompt: "Have leaders approved security objectives?", position: 0 }],
      assessment_responses: [{ question_id: "question", answer: "yes", evidence_note: "Approved" }],
    };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order"]) chain[method] = () => chain;
    chain.single = chain.maybeSingle = () => Promise.resolve({ data: rows[table][0], error: null });
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve);
    return chain;
  } },
}) }));
import AssessmentPage from "./page";
describe("completed assessment display", () => {
  it.each(["owner", "admin", "member"])("renders completed answers read-only for %s", async (role) => {
    state.role = role; state.status = "completed";
    render(await AssessmentPage({ params: Promise.resolve({ id: "session" }) }));
    expect(screen.getByRole("radio", { name: "Yes" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Evidence note" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save and complete" })).not.toBeInTheDocument();
    expect(screen.getByText(/assessment is complete/i)).toBeInTheDocument();
  });
  it("still permits an operator to edit a draft", async () => {
    state.role = "owner"; state.status = "draft";
    render(await AssessmentPage({ params: Promise.resolve({ id: "session" }) }));
    expect(screen.getByRole("radio", { name: "Yes" })).toBeEnabled();
  });
});
