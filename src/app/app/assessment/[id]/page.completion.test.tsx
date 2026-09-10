import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ status: "completed", role: "owner", activeReview: false, reviewError: false }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../actions", () => ({ createSoaAction: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org" }, membership: { role: state.role },
  supabase: { from: (table: string) => {
    const rows: Record<string, unknown[]> = {
      ai_workspace_settings: [{ enabled: false }],
      assessment_sessions: [{ id: "session", title: "Review", state: state.status, revision: 2, catalogue_version_id: "catalogue" }],
      catalogue_categories: [{ id: "category", code: "GOV", title: "Governance", position: 0 }],
      catalogue_questions: [{ id: "question", category_id: "category", code: "GOV-01", prompt: "Have leaders approved security objectives?", position: 0 }],
      assessment_responses: [{ question_id: "question", answer: "yes", evidence_note: "Approved" }],
      soa_registers: state.activeReview ? [{ id: "review", assessment_session_id: "session", version: 4, updated_at: "2026-09-10T12:00:00.000Z", soa_snapshots: [] }] : [],
    };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
    chain.single = chain.maybeSingle = () => Promise.resolve({ data: rows[table][0], error: null });
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table], count: rows[table].length, error: table === "soa_registers" && state.reviewError ? { message: "private error" } : null }).then(resolve);
    return chain;
  } },
}) }));
import AssessmentPage from "./page";
describe("completed assessment display", () => {
  beforeEach(() => { state.status = "completed"; state.role = "owner"; state.activeReview = false; state.reviewError = false; });
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
    expect(screen.getByText(/control review will use incomplete source context/i)).toBeInTheDocument();
  });
  it("shows the completion handoff without treating answers as control decisions", async () => {
    state.role = "owner"; state.status = "completed"; state.activeReview = false;
    render(await AssessmentPage({ params: Promise.resolve({ id: "session" }), searchParams: Promise.resolve({ completed: "1" }) }));
    expect(screen.getByRole("status", { name: "Completion status" })).toHaveTextContent(/assessment completed/i);
    expect(screen.getByText(/reviewer still decides applicability, implementation status, ownership and rationale/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review controls" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Control review" })).toBeInTheDocument();
  });
  it("resumes the active review selected by the server", async () => {
    state.role = "owner"; state.status = "completed"; state.activeReview = true;
    render(await AssessmentPage({ params: Promise.resolve({ id: "session" }) }));
    expect(screen.getByRole("link", { name: "Resume control review" })).toHaveAttribute("href", "/app/soa/review");
    expect(screen.queryByRole("button", { name: "Review controls" })).not.toBeInTheDocument();
  });
  it("keeps the handoff read-only for Members", async () => {
    state.role = "member"; state.status = "completed"; state.activeReview = false;
    render(await AssessmentPage({ params: Promise.resolve({ id: "session" }) }));
    expect(screen.getByText(/workspace operator can start the control review/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review controls" })).not.toBeInTheDocument();
  });
  it("does not claim a next action when active-review status is unavailable", async () => {
    state.role = "owner"; state.status = "completed"; state.activeReview = false; state.reviewError = true;
    render(await AssessmentPage({ params: Promise.resolve({ id: "session" }) }));
    expect(screen.getByRole("heading", { name: "Control review status unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/app/assessment/session");
    expect(screen.queryByRole("button", { name: "Review controls" })).not.toBeInTheDocument();
  });
});
