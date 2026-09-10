import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "88000000-0000-4000-8000-000000000001";
const SIBLING_ORG_ID = "88000000-0000-4000-8000-000000000002";
const USER_ID = "88000000-0000-4000-8000-000000000003";
const SIBLING_REGISTER_ID = "88000000-0000-4000-8000-000000000004";
const SIBLING_ITEM_ID = "88000000-0000-4000-8000-000000000005";
const REGISTER_ID = "88000000-0000-4000-8000-000000000006";
const ITEM_ID = "88000000-0000-4000-8000-000000000007";

type QueryBuilder = {
  select: () => QueryBuilder;
  update: (value: unknown) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  order: () => QueryBuilder;
  limit: () => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};

const hoisted = vi.hoisted(() => ({ ctx: null as unknown, writes: [] as unknown[], rpc: vi.fn() }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { runImportAction } from "./actions";

function fakeSupabase() {
  return {
    rpc: hoisted.rpc,
    from(table: string) {
      const filters = new Map<string, unknown>();
      let operation: "read" | "update" = "read";
      let payload: unknown;
      const builder = {} as QueryBuilder;
      Object.assign(builder, {
        select: () => builder,
        update: (value: unknown) => { operation = "update"; payload = value; return builder; },
        eq: (column: string, value: unknown) => { filters.set(column, value); return builder; },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === "soa_registers") {
            const id = filters.get("id");
            const isActive = filters.get("organisation_id") === ORG_ID;
            return { data: isActive && id === REGISTER_ID ? { id: REGISTER_ID } : null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => {
          const isActive = filters.get("organisation_id") === ORG_ID;
          if (operation === "update" && !isActive) hoisted.writes.push({ table, payload, filters: new Map(filters) });
          const data = table !== "soa_items" ? []
            : filters.get("soa_register_id") === REGISTER_ID && isActive
              ? [{ id: ITEM_ID, organisation_id: ORG_ID, control_code: "A.1", decision_revision: 7 }]
              : filters.get("soa_register_id") === SIBLING_REGISTER_ID && !isActive
                ? [{ id: SIBLING_ITEM_ID, organisation_id: SIBLING_ORG_ID, control_code: "A.1", decision_revision: 3 }]
                : [];
          return Promise.resolve({ data, error: null, count: data.length }).then(resolve);
        },
      });
      return builder;
    },
  };
}

const soaHeaders = ["controlCode", "applicable", "justification", "status", "ownerName", "comments"];
const soaMapping = Object.fromEntries(soaHeaders.map((header) => [header, header]));
const soaRows = [["A.1", "true", "Required for this scope", "established", "", ""]];

describe("SoA imports stay in the active workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpc.mockResolvedValue({ data: [{ item_id: ITEM_ID, decision_revision: 8 }], error: null });
    hoisted.writes.length = 0;
    hoisted.ctx = {
      supabase: fakeSupabase(),
      user: { id: USER_ID },
      organisation: { id: ORG_ID },
      membership: { role: "owner" },
    };
  });

  it("does not preview a sibling organisation's explicitly selected register", async () => {
    const result = await runImportAction({
      module: "soa", headers: soaHeaders, rows: soaRows, mapping: soaMapping,
      commit: false, registerId: SIBLING_REGISTER_ID,
    });
    expect(result.notes).toContain("No SoA register found to update.");
    expect(result.updated).toBe(0);
  });

  it("does not update a sibling SoA item by forged control code", async () => {
    const result = await runImportAction({
      module: "soa", headers: soaHeaders, rows: soaRows, mapping: soaMapping,
      commit: true, registerId: SIBLING_REGISTER_ID,
    });
    expect(result.updated).toBe(0);
    expect(hoisted.writes).toEqual([]);
  });

  it("retains matched decision revisions and confirms the exact preview in one guarded batch", async () => {
    const preview = await runImportAction({
      module: "soa", headers: soaHeaders, rows: soaRows, mapping: soaMapping,
      commit: false, registerId: REGISTER_ID,
    });

    expect(preview.soaPreview).toMatchObject({
      registerId: REGISTER_ID,
      changes: [{ itemId: ITEM_ID, expectedRevision: 7 }],
    });
    expect(preview.soaPreview?.identity).toMatch(/^[a-f0-9]{64}$/);

    const committed = await runImportAction({
      module: "soa", headers: soaHeaders, rows: soaRows, mapping: soaMapping,
      commit: true, registerId: REGISTER_ID, soaPreview: preview.soaPreview,
    });

    expect(committed).toMatchObject({ updated: 1, skipped: 0, committed: true });
    expect(hoisted.rpc).toHaveBeenCalledExactlyOnceWith("update_soa_decisions_guarded", {
      target_register_id: REGISTER_ID,
      changes: [{
        itemId: ITEM_ID,
        expectedRevision: 7,
        applicable: true,
        status: "established",
        justification: "Required for this scope",
        evidence: "",
        ownerId: null,
      }],
    });
  });

  it("requires a fresh preview when any guarded revision is stale", async () => {
    const preview = await runImportAction({
      module: "soa", headers: soaHeaders, rows: soaRows, mapping: soaMapping,
      commit: false, registerId: REGISTER_ID,
    });
    hoisted.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "control_decision_stale", details: "revision_mismatch" } });

    const committed = await runImportAction({
      module: "soa", headers: soaHeaders, rows: soaRows, mapping: soaMapping,
      commit: true, registerId: REGISTER_ID, soaPreview: preview.soaPreview,
    });

    expect(committed).toMatchObject({ updated: 0, requiresFreshPreview: true });
    expect(committed.notes).toContain("A control decision changed after this preview. No controls were updated; preview the file again before confirming.");
    expect(hoisted.rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects confirmation when the file-derived rows no longer match the preview identity", async () => {
    const preview = await runImportAction({
      module: "soa", headers: soaHeaders, rows: soaRows, mapping: soaMapping,
      commit: false, registerId: REGISTER_ID,
    });

    const committed = await runImportAction({
      module: "soa", headers: soaHeaders,
      rows: [["A.1", "true", "Changed after preview", "established", "", ""]],
      mapping: soaMapping, commit: true, registerId: REGISTER_ID, soaPreview: preview.soaPreview,
    });

    expect(committed).toMatchObject({ updated: 0, requiresFreshPreview: true });
    expect(committed.notes).toContain("The selected register, file, mapping, or validated rows changed after preview. No controls were updated; preview the file again before confirming.");
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });
});
