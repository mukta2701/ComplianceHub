import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const QUESTION_ID = "30000000-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  role: "owner",
  failTable: "",
  riskInsert: null as Record<string, unknown> | null,
  response: {
    organisation_id: "10000000-0000-4000-8000-000000000001",
    session_id: "20000000-0000-4000-8000-000000000001",
    question_id: "30000000-0000-4000-8000-000000000001",
    answer: "no",
    updated_at: "2026-09-10T08:00:00.000Z",
    catalogue_questions: { code: "A.5", prompt: "Access is reviewed", remediation: "Run quarterly reviews", weight: 3 },
  } as Record<string, unknown>,
}));

function query(table: string) {
  let single = false;
  let inserted: Record<string, unknown> | null = null;
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; };
  chain.in = (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return chain; };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.insert = (value: Record<string, unknown>) => { inserted = value; return chain; };
  for (const name of ["single", "maybeSingle"]) chain[name] = () => { single = true; return chain; };
  chain.then = (resolve: (value: unknown) => unknown) => {
    if (state.failTable === table) return Promise.resolve({ data: null, error: { code: "08006" } }).then(resolve);
    if (table === "assessment_responses") {
      const match = filters.every((filter) => filter(state.response));
      return Promise.resolve({ data: match ? state.response : null, error: null }).then(resolve);
    }
    if (table === "risk_categories") {
      const row = { id: "40000000-0000-4000-8000-000000000001", organisation_id: ORG_ID, name: "Readiness", position: 7 };
      return Promise.resolve({ data: single ? row : [row], error: null }).then(resolve);
    }
    if (table === "risks" && inserted) {
      state.riskInsert = inserted;
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    if (table === "risks") {
      return Promise.resolve({ data: [{ reference: "R-001" }, { reference: "R-003" }], error: null }).then(resolve);
    }
    return Promise.resolve({ data: single ? null : [], error: null }).then(resolve);
  };
  return chain;
}

vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  supabase: { from: query },
  organisation: { id: ORG_ID },
  user: { id: "50000000-0000-4000-8000-000000000001" },
  membership: { role: state.role },
}) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { acceptRiskSuggestionAction } from "./actions";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ questionId: QUESTION_ID, sessionId: SESSION_ID, ...overrides })) data.set(key, value);
  return data;
}

beforeEach(() => {
  state.role = "owner";
  state.failTable = "";
  state.riskInsert = null;
  state.response.answer = "no";
});

describe("accepting an assessment gap as a risk", () => {
  it("requires the current workspace response to remain a gap", async () => {
    state.response.answer = "yes";
    await expect(acceptRiskSuggestionAction(form())).rejects.toThrow("no longer available");
    expect(state.riskInsert).toBeNull();
  });

  it("rejects a question and session that are not paired", async () => {
    await expect(acceptRiskSuggestionAction(form({ sessionId: "20000000-0000-4000-8000-000000000099" }))).rejects.toThrow("no longer available");
    expect(state.riskInsert).toBeNull();
  });

  it("does not turn a failed provenance read into a new risk", async () => {
    state.failTable = "assessment_responses";
    await expect(acceptRiskSuggestionAction(form())).rejects.toThrow("Could not verify");
    expect(state.riskInsert).toBeNull();
  });

  it("records the accepted answer, question and observation time", async () => {
    await acceptRiskSuggestionAction(form());
    expect(state.riskInsert).toMatchObject({
      reference: "R-002",
      title: "Readiness gap: Access is reviewed",
      source_assessment_session_id: SESSION_ID,
    });
    expect(state.riskInsert?.evidence).toContain(`question ${QUESTION_ID}; answer no; observed response update 2026-09-10T08:00:00.000Z`);
  });
});
