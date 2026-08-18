import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANISATION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const REGISTER_ID = "55555555-5555-4555-8555-555555555555";
const AUDIT_ID = "66666666-6666-4666-8666-666666666666";
const SNAPSHOT_ID = "77777777-7777-4777-8777-777777777777";

const hoisted = vi.hoisted(() => ({
  requireContext: vi.fn(),
  createClient: vi.fn(),
  queries: [] as Array<{ table: string; column: string; value: unknown }>,
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: hoisted.createClient }));

type Row = Record<string, unknown>;

const siblingRows: Record<string, Row[]> = {
  assessment_sessions: [{ id: SESSION_ID, organisation_id: OTHER_ORGANISATION_ID, catalogue_version_id: "catalogue-1", updated_at: "2026-08-18T00:00:00Z" }],
  soa_registers: [{ id: REGISTER_ID, organisation_id: OTHER_ORGANISATION_ID, updated_at: "2026-08-18T00:00:00Z" }],
  audits: [{ id: AUDIT_ID, organisation_id: OTHER_ORGANISATION_ID, reference: "SIBLING-AUDIT", title: "Sibling-only audit" }],
  soa_snapshots: [{ id: SNAPSHOT_ID, organisation_id: OTHER_ORGANISATION_ID, title: "Sibling-only snapshot", version: 1, organisation_name: "Sibling", finalised_at: "2026-08-18T00:00:00Z", finalised_by: "sibling-user", assessment_session_id: "sibling-assessment", items: [], catalogue_versions: null }],
  assets: [{ organisation_id: OTHER_ORGANISATION_ID, reference: "SIBLING-ASSET", description: "Sibling-only asset", owner_location: "Sibling", classification: "internal", value_criticality: "low", security_controls: "Sibling-only", lifespan: "1 year", last_updated: null, remarks: "Sibling-only" }],
  evidence: [
    { organisation_id: ORGANISATION_ID, id: "active-evidence", title: "Active evidence", kind: "note", status: "current", collected_on: "2026-08-18", valid_until: null, profiles: null },
    { organisation_id: OTHER_ORGANISATION_ID, id: "sibling-evidence", title: "Sibling-only evidence", kind: "note", status: "current", collected_on: "2026-08-18", valid_until: null, profiles: null },
  ],
  risks: [{ organisation_id: OTHER_ORGANISATION_ID, reference: "SIBLING-RISK", title: "Sibling-only risk", description: "Sibling-only risk", likelihood: 1, impact: 1, treatment_plan: "Sibling-only", status: "open", review_date: null, risk_categories: null, profiles: null }],
  tasks: [{ organisation_id: OTHER_ORGANISATION_ID, id: "sibling-task", title: "Sibling-only task", detail: "Sibling-only", status: "open", due_on: null, recurrence: null, source: "manual", profiles: null }],
  soa_items: [{ organisation_id: OTHER_ORGANISATION_ID, soa_register_id: REGISTER_ID, control_code: "SIBLING-CTRL", control_title: "Sibling-only control", applicable: true, status: "operational", justification: "Sibling-only", evidence: "Sibling-only", owner_id: null, position: 1 }],
};

function rowsFor(table: string): Row[] {
  if (table === "catalogue_questions") return [];
  if (table === "assessment_responses") return [];
  if (table === "memberships") return [];
  return siblingRows[table] ?? [];
}

function fakeClient() {
  return {
    from(table: string) {
      const equals: Array<[string, unknown]> = [];
      // The minimal fake deliberately leaves Supabase's fluent builder dynamic.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: Record<string, (...args: any[]) => any> = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => {
          equals.push([column, value]);
          hoisted.queries.push({ table, column, value });
          return builder;
        }),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => {
          const rows = rowsFor(table).filter((row) => equals.every(([column, value]) => row[column] === value));
          return { data: rows[0] ?? null, error: null };
        }),
        single: vi.fn(async () => {
          const rows = rowsFor(table).filter((row) => equals.every(([column, value]) => row[column] === value));
          return { data: rows[0] ?? null, error: null };
        }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const rows = rowsFor(table).filter((row) => equals.every(([column, value]) => row[column] === value));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function context() {
  const supabase = fakeClient();
  return {
    supabase,
    user: { id: USER_ID },
    membership: { role: "owner" },
    organisation: { id: ORGANISATION_ID, name: "Active organisation" },
  };
}

beforeEach(() => {
  vi.resetModules();
  hoisted.queries.length = 0;
  const activeContext = context();
  hoisted.requireContext.mockResolvedValue(activeContext);
  hoisted.createClient.mockResolvedValue({
    ...activeContext.supabase,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
  });
});

describe("active-organisation export boundaries", () => {
  it("does not export a sibling organisation's assessment when an explicit session id is supplied", async () => {
    const { GET } = await import("./assessment/export/route");

    const response = await GET(new Request(`http://localhost/api/app/assessment/export?format=csv&sessionId=${SESSION_ID}`));

    expect(response.status).toBe(404);
    expect(hoisted.queries).toContainEqual({ table: "assessment_sessions", column: "organisation_id", value: ORGANISATION_ID });
  });

  it.each([
    ["assets", "SIBLING-ASSET"],
    ["evidence", "Sibling-only evidence"],
    ["risks", "SIBLING-RISK"],
    ["tasks", "Sibling-only task"],
  ])("does not include sibling rows in the %s export", async (resource, siblingValue) => {
    const routes = {
      assets: () => import("./assets/export/route"),
      evidence: () => import("./evidence/export/route"),
      risks: () => import("./risks/export/route"),
      tasks: () => import("./tasks/export/route"),
    } as const;
    const { GET } = await routes[resource as keyof typeof routes]();

    const response = await GET(new Request(`http://localhost/api/app/${resource}/export?format=csv`));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain(siblingValue);
    expect(hoisted.queries).toContainEqual({ table: resource, column: "organisation_id", value: ORGANISATION_ID });
  });

  it("labels evidence with no owner as Unassigned", async () => {
    const { GET } = await import("./evidence/export/route");

    const response = await GET(new Request("http://localhost/api/app/evidence/export?format=csv"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Active evidence,note,current,2026-08-18,,Unassigned");
  });

  it("does not export SoA items from a sibling organisation for an explicit register id", async () => {
    const { GET } = await import("./soa/export/route");

    const response = await GET(new Request(`http://localhost/api/app/soa/export?format=csv&registerId=${REGISTER_ID}`));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain("SIBLING-CTRL");
    expect(hoisted.queries).toContainEqual({ table: "soa_registers", column: "organisation_id", value: ORGANISATION_ID });
  });

  it("does not export a sibling organisation's audit pack", async () => {
    const { GET } = await import("./audits/[id]/pack/route");

    const response = await GET(
      new Request("http://localhost/api/app/audits/" + AUDIT_ID + "/pack?format=csv"),
      { params: Promise.resolve({ id: AUDIT_ID }) },
    );

    expect(response.status).toBe(404);
    expect(hoisted.queries).toContainEqual({ table: "audits", column: "organisation_id", value: ORGANISATION_ID });
  });

  it("does not export a sibling organisation's finalised SoA snapshot", async () => {
    const { GET } = await import("./soa/[snapshotId]/[format]/route");

    const response = await GET(
      new Request("http://localhost/api/app/soa/" + SNAPSHOT_ID + "/pdf"),
      { params: Promise.resolve({ snapshotId: SNAPSHOT_ID, format: "pdf" }) },
    );

    expect(response.status).toBe(404);
    expect(hoisted.queries).toContainEqual({ table: "soa_snapshots", column: "organisation_id", value: ORGANISATION_ID });
  });
});
