import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryRecord = { table: string; operations: Array<{ name: string; args: unknown[] }> };

const fixture = vi.hoisted(() => ({
  role: "owner",
  failTable: "",
  countMismatchTable: "",
  sessionCount: 2,
  queries: [] as QueryRecord[],
  sessions: [
    { id: "complete", title: "Annual readiness review", state: "completed", revision: 7, updated_at: "2026-09-10T10:30:00.000Z", catalogue_version_id: "catalogue" },
    { id: "draft", title: "Supplier follow-up", state: "draft", revision: 3, updated_at: "2026-09-09T09:00:00.000Z", catalogue_version_id: "catalogue" },
  ],
  questions: [
    { id: "q1", catalogue_version_id: "catalogue" },
    { id: "q2", catalogue_version_id: "catalogue" },
    { id: "q3", catalogue_version_id: "catalogue" },
  ],
  responses: [
    { session_id: "complete", question_id: "q1", answer: "yes", evidence_note: "Board minutes" },
    { session_id: "complete", question_id: "q2", answer: "partially", evidence_note: "" },
    { session_id: "complete", question_id: "q3", answer: "no", evidence_note: "Gap confirmed" },
    { session_id: "draft", question_id: "q1", answer: "yes", evidence_note: "" },
  ],
  reviews: [
    { id: "review-8", assessment_session_id: "complete", version: 8, updated_at: "2026-09-10T11:00:00.000Z", soa_snapshots: [] },
  ],
}));

vi.mock("../actions", () => ({ createAssessmentAction: vi.fn() }));

function query(table: string) {
  const record: QueryRecord = { table, operations: [] };
  fixture.queries.push(record);
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "order", "limit"]) {
    chain[name] = (...args: unknown[]) => {
      record.operations.push({ name, args });
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) => {
    const data = table === "assessment_sessions" ? fixture.sessions
      : table === "catalogue_questions" ? fixture.questions
      : table === "assessment_responses" ? fixture.responses
      : table === "soa_registers" ? fixture.reviews
      : [];
    const count = (table === "assessment_sessions" ? fixture.sessionCount : data.length) + (fixture.countMismatchTable === table ? 1 : 0);
    return Promise.resolve({ data, count, error: fixture.failTable === table ? { message: "private read error" } : null }).then(resolve);
  };
  return chain;
}

vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org" }, membership: { role: fixture.role }, supabase: { from: query },
}) }));

import AssessmentsPage from "./page";

describe("assessment register journey", () => {
  beforeEach(() => {
    fixture.role = "owner";
    fixture.failTable = "";
    fixture.countMismatchTable = "";
    fixture.sessionCount = 2;
    fixture.queries = [];
    fixture.reviews = [
      { id: "review-8", assessment_session_id: "complete", version: 8, updated_at: "2026-09-10T11:00:00.000Z", soa_snapshots: [] },
    ];
    fixture.sessions = [
      { id: "complete", title: "Annual readiness review", state: "completed", revision: 7, updated_at: "2026-09-10T10:30:00.000Z", catalogue_version_id: "catalogue" },
      { id: "draft", title: "Supplier follow-up", state: "draft", revision: 3, updated_at: "2026-09-09T09:00:00.000Z", catalogue_version_id: "catalogue" },
    ];
  });

  it("shows complete and incomplete progress with supporting-note gaps", async () => {
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));

    const complete = screen.getByRole("article", { name: "Annual readiness review assessment" });
    expect(within(complete).getByText("3 of 3 answered")).toBeInTheDocument();
    expect(within(complete).getByText("1 answer lacks a supporting note")).toBeInTheDocument();
    expect(within(complete).getByText("Completed")).toBeInTheDocument();
    expect(within(complete).getByRole("progressbar")).toHaveAttribute("value", "3");

    const draft = screen.getByRole("article", { name: "Supplier follow-up assessment" });
    expect(within(draft).getByText("1 of 3 answered")).toBeInTheDocument();
    expect(within(draft).getByText("2 unanswered")).toBeInTheDocument();
    expect(within(draft).getByText("1 answer lacks a supporting note")).toBeInTheDocument();
    expect(within(draft).getByText("In progress")).toBeInTheDocument();
  });

  it("resumes an active review and otherwise routes the next action through assessment detail", async () => {
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));

    expect(within(screen.getByRole("article", { name: "Annual readiness review assessment" }))
      .getByRole("link", { name: "Resume control review" })).toHaveAttribute("href", "/app/soa/review-8");
    expect(within(screen.getByRole("article", { name: "Supplier follow-up assessment" }))
      .getByRole("link", { name: "Continue assessment" })).toHaveAttribute("href", "/app/assessment/draft");
  });

  it("routes a completed assessment without an active review through its authoritative detail page", async () => {
    fixture.reviews = [];
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));

    expect(within(screen.getByRole("article", { name: "Annual readiness review assessment" }))
      .getByRole("link", { name: "Review controls" })).toHaveAttribute("href", "/app/assessment/complete");
  });

  it.each(["assessment_sessions", "catalogue_questions", "assessment_responses", "soa_registers"])("shows retryable unavailable state when %s cannot be verified", async (table) => {
    fixture.failTable = table;
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Assessment register unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/could not verify assessment progress and control review links/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/app/assessment");
    expect(screen.queryByText("No assessments are available yet")).not.toBeInTheDocument();
  });

  it("shows the unavailable panel when a related result is truncated", async () => {
    fixture.countMismatchTable = "assessment_responses";
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Assessment register unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/app/assessment");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("limits the displayed register while keeping the complete count explicit", async () => {
    fixture.sessionCount = 51;
    fixture.sessions = Array.from({ length: 50 }, (_, index) => ({
      id: `session-${index}`, title: `Assessment ${index + 1}`, state: "draft", revision: 1,
      updated_at: "2026-09-10T10:30:00.000Z", catalogue_version_id: "catalogue",
    }));
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Showing 50 of 51 assessments")).toBeInTheDocument();
    const sessionQuery = fixture.queries.find((item) => item.table === "assessment_sessions");
    expect(sessionQuery?.operations).toEqual(expect.arrayContaining([
      { name: "eq", args: ["organisation_id", "org"] },
      { name: "limit", args: [50] },
    ]));
  });

  it("keeps Member actions read-only", async () => {
    fixture.role = "member";
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("button", { name: /New assessment|Start your first assessment/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Annual readiness review assessment" }))
      .getByRole("link", { name: "View control review" })).toHaveAttribute("href", "/app/soa/review-8");
    expect(within(screen.getByRole("article", { name: "Supplier follow-up assessment" }))
      .getByRole("link", { name: "View assessment" })).toHaveAttribute("href", "/app/assessment/draft");
  });
});
