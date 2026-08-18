import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "99000000-0000-4000-8000-000000000001";
const SIBLING_ORG_ID = "99000000-0000-4000-8000-000000000002";
const USER_ID = "99000000-0000-4000-8000-000000000003";
const SESSION_ID = "99000000-0000-4000-8000-000000000004";
const QUESTION_ID = "99000000-0000-4000-8000-000000000005";

type QueryBuilder = {
  select: () => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
};
type FakeSupabase = {
  auth: { getUser: ReturnType<typeof vi.fn> };
  from: (table: string) => QueryBuilder;
  rpc: ReturnType<typeof vi.fn>;
};
type AutosaveInput = { sessionId: string; questionId: string; answer: string; evidenceNote: string; expectedRevision: number };
type AutosaveAdapter = { save: (input: AutosaveInput) => Promise<unknown> };

const hoisted = vi.hoisted(() => ({
  supabase: null as FakeSupabase | null,
  membership: null as unknown,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => Promise.resolve(hoisted.supabase) }));
vi.mock("@/lib/app-context", () => ({ getMembership: () => Promise.resolve(hoisted.membership) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("@/features/assessment/application/autosave", async () => ({
  saveAssessmentResponse: async (input: unknown, adapter: AutosaveAdapter) => adapter.save(input as AutosaveInput),
}));

import { PATCH } from "./route";

function fakeSupabase() {
  const supabase: FakeSupabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from(table: string) {
      const filters = new Map<string, unknown>();
      const builder = {} as QueryBuilder;
      Object.assign(builder, {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters.set(column, value); return builder; },
        maybeSingle: async () => ({
          data: table === "assessment_sessions" && filters.get("id") === SESSION_ID && !filters.has("organisation_id")
              ? { id: SESSION_ID, organisation_id: SIBLING_ORG_ID }
              : null,
          error: null,
        }),
      });
      return builder;
    },
    rpc: hoisted.rpc,
  };
  return supabase;
}

describe("PATCH /api/app/assessment/response workspace boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.membership = { organisation_id: ORG_ID };
    hoisted.supabase = fakeSupabase();
  });

  it("rejects a response for a session owned by a sibling organisation", async () => {
    const response = await PATCH(new Request("http://localhost/api/app/assessment/response", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID, questionId: QUESTION_ID, answer: "yes", evidenceNote: "", expectedRevision: 0 }),
    }));

    expect(response.status).toBe(404);
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });
});

void SIBLING_ORG_ID;
