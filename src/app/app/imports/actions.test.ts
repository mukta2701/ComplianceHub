import { describe, expect, it, vi } from "vitest";
import { riskInputSchema } from "@/features/risks/application/risk";

// runImportAction is a server action ("use server") that calls requireAppContext()
// for its Supabase client. Rather than a live DB, we mock app-context with an
// in-memory fake store — modelling the query shapes used by risk and asset
// imports, including capped reads and write failures (mirrors the pattern used by
// src/app/api/cron/daily/route.test.ts).

const hoisted = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type Row = Record<string, unknown>;
type Store = { risk_categories: Row[]; asset_categories?: Row[]; memberships: Row[]; risks: Row[]; assets?: Row[] };

type Result = { data: unknown; error: unknown; count?: number };

// Minimal chainable database boundary fake with workspace filters, exact counts,
// capped/paginated reads and category/asset insertion outcomes.
class Builder implements PromiseLike<Result> {
  private filters: [string, unknown][] = [];
  private op: "select" | "insert" = "select";
  private payload: Row = {};
  private countHead = false;
  private countRequested = false;
  private bounds: [number, number] = [0, 999];
  private singleResult = false;
  private orderColumn: string | null = null;

  constructor(private rows: Row[], private readError: unknown = null, private countOverride: number | undefined = undefined, private insertError: unknown = null, private failFrom?: number) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.countHead = true;
    if (opts?.count) this.countRequested = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  order(column: string) { this.orderColumn = column; return this; }
  range(from: number, to: number) { this.bounds = [from, to]; return this; }
  single() { this.singleResult = true; return this; }

  private matched() {
    return this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }

  private resolve(): Result {
    if (this.op === "insert") {
      if (this.insertError) return { data: null, error: this.insertError };
      const inserted = { id: `00000000-0000-4000-8000-${String(this.rows.length + 100).padStart(12, "0")}`, ...this.payload };
      this.rows.push(inserted);
      return { data: this.singleResult ? inserted : [inserted], error: null };
    }
    if (this.readError || (this.failFrom !== undefined && this.bounds[0] >= this.failFrom)) return { data: null, error: this.readError ?? new Error("private page diagnostic") };
    if (this.countHead) return { data: null, error: null, count: this.countOverride ?? this.matched().length };
    const matched = this.matched();
    if (this.orderColumn) matched.sort((a, b) => String(a[this.orderColumn!]).localeCompare(String(b[this.orderColumn!])));
    return { data: matched.slice(this.bounds[0], this.bounds[1] + 1), error: null, count: this.countRequested ? this.countOverride ?? matched.length : undefined };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

type FakeOptions = { membershipsError?: unknown; membershipsCount?: number; categoryError?: unknown; categoryInsertError?: unknown; categoryCount?: number; assetsError?: unknown; assetsFailFrom?: number; assetsCount?: number; assetsInsertError?: unknown };
function fakeSupabase(store: Store, options: FakeOptions = {}) {
  return { from: (table: keyof Store) => new Builder(
    store[table] ?? [],
    table === "memberships" ? options.membershipsError : table === "asset_categories" ? options.categoryError : table === "assets" ? options.assetsError : null,
    table === "memberships" ? options.membershipsCount : table === "asset_categories" ? options.categoryCount : table === "assets" ? options.assetsCount : undefined,
    table === "asset_categories" ? options.categoryInsertError : table === "assets" ? options.assetsInsertError : null,
    table === "assets" ? options.assetsFailFrom : undefined,
  ) };
}

// zod's uuid() format requires valid version/variant nibbles, so these can't just be "org-1" etc.
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const CATEGORY_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const ASSET_OWNER_ID = "00000000-0000-4000-8000-000000000004";

const HEADERS = ["description", "categoryName", "likelihood", "impact"];
const MAPPING = { description: "description", categoryName: "categoryName", likelihood: "likelihood", impact: "impact" };
const validRow = (n: number) => [`Row ${n} description`, "Operational", "3", "2"];
const ASSET_HEADERS = ["Asset Description", "Owner & Location", "In-app owner", "Classification", "Value (Criticality)"];
const ASSET_MAPPING = { "Asset Description": "description", "Owner & Location": "ownerLocation", "In-app owner": "ownerName", Classification: "classification", "Value (Criticality)": "valueCriticality" };

describe("runImportAction — row cap (Fix 1)", () => {
  it("caps input.rows at MAX_IMPORT_ROWS regardless of how many the caller posts", async () => {
    hoisted.ctx = { supabase: fakeSupabase({ risk_categories: [], memberships: [], risks: [] }), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");
    const { MAX_IMPORT_ROWS } = await import("@/features/imports/limits");

    const oversized = Array.from({ length: MAX_IMPORT_ROWS + 137 }, (_, i) => validRow(i));
    const result = await runImportAction({ module: "risk", headers: HEADERS, rows: oversized, mapping: MAPPING, commit: false });

    expect(result.total).toBe(MAX_IMPORT_ROWS);
    expect(result.valid).toBe(MAX_IMPORT_ROWS);
    expect(result.notes).toEqual([`Import is limited to ${MAX_IMPORT_ROWS} rows per file; ${oversized.length} rows were provided.`]);
  });

  it("does not truncate (or add a note) when rows are within the ceiling", async () => {
    hoisted.ctx = { supabase: fakeSupabase({ risk_categories: [], memberships: [], risks: [] }), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");

    const rows = [validRow(1), validRow(2)];
    const result = await runImportAction({ module: "risk", headers: HEADERS, rows, mapping: MAPPING, commit: false });

    expect(result.total).toBe(2);
    expect(result.notes).toEqual([]);
  });
});

describe("runImportAction — safeParse resilience (Fix 3)", () => {
  it("skips a row that fails schema re-validation instead of throwing and aborting the batch", async () => {
    const store: Store = {
      risk_categories: [{ id: CATEGORY_ID, organisation_id: ORG_ID, name: "Operational", position: 0 }],
      memberships: [],
      risks: [],
    };
    hoisted.ctx = { supabase: fakeSupabase(store), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");

    const original = riskInputSchema.safeParse.bind(riskInputSchema);
    let call = 0;
    const spy = vi.spyOn(riskInputSchema, "safeParse").mockImplementation((...args: Parameters<typeof original>) => {
      call += 1;
      if (call === 2) return { success: false, error: { issues: [{ message: "synthetic schema mismatch" }] } } as ReturnType<typeof original>;
      return original(...args);
    });

    try {
      const rows = [validRow(1), validRow(2), validRow(3)];
      const result = await runImportAction({ module: "risk", headers: HEADERS, rows, mapping: MAPPING, commit: true });

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.notes.some((n) => n.includes("synthetic schema mismatch"))).toBe(true);
      expect(store.risks).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("runImportAction — active workspace reference lookups", () => {
  it("counts only active-workspace risks when generating references", async () => {
    const store: Store = {
      risk_categories: [{ id: CATEGORY_ID, organisation_id: ORG_ID, name: "Operational", position: 0 }],
      memberships: [],
      risks: [
        { id: "risk-active", organisation_id: ORG_ID },
        { id: "risk-sibling", organisation_id: "00000000-0000-4000-8000-000000000099" },
      ],
    };
    hoisted.ctx = { supabase: fakeSupabase(store), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");

    const result = await runImportAction({ module: "risk", headers: HEADERS, rows: [validRow(1)], mapping: MAPPING, commit: true });

    expect(result.imported).toBe(1);
    expect(store.risks.at(-1)).toMatchObject({ reference: "R-002", organisation_id: ORG_ID });
  });
});

describe("runImportAction — asset owners", () => {
  it("preserves descriptive owner and location without assigning the matching member", async () => {
    const store: Store = {
      risk_categories: [], asset_categories: [], risks: [], assets: [],
      memberships: [{ organisation_id: ORG_ID, user_id: ASSET_OWNER_ID, profiles: { display_name: "Ada Lovelace" } }],
    };
    hoisted.ctx = { supabase: fakeSupabase(store), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");

    const result = await runImportAction({ module: "asset", headers: ASSET_HEADERS, rows: [["Customer database", "Ada Lovelace", "", "Highly Confidential", "High"]], mapping: ASSET_MAPPING, commit: true });

    expect(result.imported).toBe(1);
    expect(store.assets).toContainEqual(expect.objectContaining({ owner_location: "Ada Lovelace", owner_id: null }));
  });

  it("validates unique in-app owners again for preview and commit", async () => {
    const store: Store = {
      risk_categories: [], asset_categories: [], risks: [], assets: [],
      memberships: [
        { organisation_id: ORG_ID, user_id: ASSET_OWNER_ID, profiles: { display_name: "London" } },
        { organisation_id: ORG_ID, user_id: "00000000-0000-4000-8000-000000000005", profiles: { display_name: "Alex Example" } },
        { organisation_id: ORG_ID, user_id: "00000000-0000-4000-8000-000000000006", profiles: { display_name: "Alex Example" } },
      ],
    };
    hoisted.ctx = { supabase: fakeSupabase(store), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");
    const rows = [
      ["Customer database", "London office", " lOnDoN ", "Highly Confidential", "High"],
      ["Meeting room display", "London", "", "Internal Use Only", "Low"],
      ["Support portal", "Remote", "Alex Example", "Confidential", "Medium"],
      ["Archive", "Storage", "Missing Person", "Internal Use Only", "Low"],
    ];

    const preview = await runImportAction({ module: "asset", headers: ASSET_HEADERS, rows, mapping: ASSET_MAPPING, commit: false });

    expect(preview).toMatchObject({ valid: 2, invalid: 2, imported: 2 });
    expect(preview.rowErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, errors: [expect.stringMatching(/more than one member/i)] }),
      expect.objectContaining({ row: 4, errors: [expect.stringMatching(/not found in this workspace/i)] }),
    ]));

    const committed = await runImportAction({ module: "asset", headers: ASSET_HEADERS, rows, mapping: ASSET_MAPPING, commit: true });

    expect(committed).toMatchObject({ imported: 2, skipped: 2 });
    expect(store.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: "Customer database", owner_location: "London office", owner_id: ASSET_OWNER_ID }),
      expect.objectContaining({ description: "Meeting room display", owner_location: "London", owner_id: null }),
    ]));
  });

  it("skips named owners when the current-workspace membership lookup is unavailable", async () => {
    const store: Store = { risk_categories: [], asset_categories: [], memberships: [], risks: [], assets: [] };
    hoisted.ctx = { supabase: fakeSupabase(store, { membershipsError: new Error("database unavailable") }), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");
    const rows = [
      ["Customer database", "London office", "London", "Highly Confidential", "High"],
      ["Meeting room display", "London", "", "Internal Use Only", "Low"],
    ];

    const preview = await runImportAction({ module: "asset", headers: ASSET_HEADERS, rows, mapping: ASSET_MAPPING, commit: false });

    expect(preview).toMatchObject({ valid: 1, invalid: 1, imported: 1 });
    expect(preview.rowErrors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 1, errors: [expect.stringMatching(/could not look up/i)] })]));

    const committed = await runImportAction({ module: "asset", headers: ASSET_HEADERS, rows, mapping: ASSET_MAPPING, commit: true });

    expect(committed).toMatchObject({ imported: 1, skipped: 1 });
    expect(committed.notes).toEqual(expect.arrayContaining([expect.stringMatching(/could not look up/i)]));
    expect(store.assets).toContainEqual(expect.objectContaining({ description: "Meeting room display", owner_id: null }));
  });

  it("does not treat a partial member list as a unique in-app owner match", async () => {
    const store: Store = {
      risk_categories: [], asset_categories: [], risks: [], assets: [],
      memberships: [{ organisation_id: ORG_ID, user_id: ASSET_OWNER_ID, profiles: { display_name: "London" } }],
    };
    hoisted.ctx = { supabase: fakeSupabase(store, { membershipsCount: 2 }), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");
    const rows = [
      ["Customer database", "London office", "London", "Highly Confidential", "High"],
      ["Meeting room display", "London", "", "Internal Use Only", "Low"],
    ];

    const preview = await runImportAction({ module: "asset", headers: ASSET_HEADERS, rows, mapping: ASSET_MAPPING, commit: false });

    expect(preview).toMatchObject({ valid: 1, invalid: 1, imported: 1 });
    expect(preview.rowErrors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 1, errors: [expect.stringMatching(/complete in-app owner list/i)] })]));
  });

  it("rechecks exact current-workspace owner matching when membership changes after preview", async () => {
    const store: Store = {
      risk_categories: [], asset_categories: [], risks: [], assets: [],
      memberships: [{ organisation_id: ORG_ID, user_id: ASSET_OWNER_ID, profiles: { display_name: "London" } }],
    };
    hoisted.ctx = { supabase: fakeSupabase(store), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" }, membership: { role: "owner" } };
    const { runImportAction } = await import("./actions");
    const rows = [["Customer database", "London office", " lOnDoN ", "Highly Confidential", "High"]];

    const preview = await runImportAction({ module: "asset", headers: ASSET_HEADERS, rows, mapping: ASSET_MAPPING, commit: false });

    expect(preview).toMatchObject({ valid: 1, invalid: 0, imported: 1 });
    store.memberships.splice(0, 1, { organisation_id: "00000000-0000-4000-8000-000000000099", user_id: "00000000-0000-4000-8000-000000000007", profiles: { display_name: "London" } });

    const committed = await runImportAction({ module: "asset", headers: ASSET_HEADERS, rows, mapping: ASSET_MAPPING, commit: true });

    expect(committed).toMatchObject({ imported: 0, skipped: 1 });
    expect(committed.notes).toEqual(expect.arrayContaining([expect.stringMatching(/not found in this workspace/i)]));
    expect(store.assets).toEqual([]);
  });
});


describe("runImportAction — reliable asset imports", () => {
  const headers = ["Reference", "Description", "Category", "Classification", "Value"];
  const mapping = { Reference: "reference", Description: "description", Category: "categoryName", Classification: "classification", Value: "valueCriticality" };
  const row = (reference: string, category = "") => [reference, "Imported asset", category, "Internal Use Only", "Medium"];
  function setup(options: FakeOptions = {}, extra: Partial<Store> = {}) {
    const store: Store = { risk_categories: [], asset_categories: [], memberships: [], risks: [], assets: [], ...extra };
    hoisted.ctx = { supabase: fakeSupabase(store, options), user: { id: USER_ID }, organisation: { id: ORG_ID }, membership: { role: "owner" } };
    return store;
  }

  it("skips a requested category that cannot be created while importing deliberately uncategorised rows", async () => {
    const store = setup({ categoryInsertError: new Error("private category diagnostic") });
    const { runImportAction } = await import("./actions");
    const result = await runImportAction({ module: "asset", headers, mapping, rows: [row("AST-001", "Infrastructure"), row("AST-002")], commit: true });
    expect(result).toMatchObject({ imported: 1, skipped: 1 });
    expect(result.notes).toEqual([expect.stringMatching(/AST-001.*category.*not imported/i)]);
    expect(JSON.stringify(result)).not.toContain("private category diagnostic");
    expect(store.assets).toEqual([expect.objectContaining({ reference: "AST-002", category_id: null })]);
  });

  it("does not create a replacement category when the workspace category read fails", async () => {
    const store = setup({ categoryError: new Error("private lookup diagnostic") });
    const { runImportAction } = await import("./actions");
    const result = await runImportAction({ module: "asset", headers, mapping, rows: [row("AST-001", "Infrastructure"), row("AST-002")], commit: true });
    expect(result).toMatchObject({ imported: 1, skipped: 1 });
    expect(store.asset_categories).toEqual([]);
    expect(store.assets).toEqual([expect.objectContaining({ reference: "AST-002" })]);
    expect(JSON.stringify(result)).not.toContain("private lookup diagnostic");
  });


  it("matches categories beyond the database page cap instead of creating duplicates", async () => {
    const categories = Array.from({ length: 1001 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, organisation_id: ORG_ID, name: `Category ${index}`, position: index }));
    const store = setup({}, { asset_categories: categories });
    const { runImportAction } = await import("./actions");
    const result = await runImportAction({ module: "asset", headers, mapping, rows: [row("AST-001", "category 1000")], commit: true });
    expect(result).toMatchObject({ imported: 1, skipped: 0 });
    expect(store.asset_categories).toHaveLength(1001);
    expect(store.assets).toEqual([expect.objectContaining({ category_id: categories[1000].id })]);
  });


  it("reserves sparse workspace references beyond one page and explicit references later in the batch", async () => {
    const occupied = Array.from({ length: 1000 }, (_, index) => ({ id: String(index).padStart(5, "0"), organisation_id: ORG_ID, reference: `AST-${String(index + 1).padStart(3, "0")}` }));
    occupied.push({ id: "99998", organisation_id: ORG_ID, reference: "AST-1002" });
    occupied.push({ id: "99999", organisation_id: "another-workspace", reference: "AST-1003" });
    const store = setup({}, { assets: occupied });
    const { runImportAction } = await import("./actions");
    const result = await runImportAction({ module: "asset", headers, mapping, rows: [row(""), row("AST-1001"), row("")], commit: true });
    expect(result).toMatchObject({ imported: 3, skipped: 0 });
    expect(store.assets?.slice(-3).map((asset) => asset.reference)).toEqual(["AST-1003", "AST-1001", "AST-1004"]);
  });


  it.each([
    { assetsError: new Error("private reference diagnostic") },
    { assetsCount: 1 },
  ])("skips generated references when the complete workspace lookup is unavailable: %j", async (options) => {
    const store = setup(options);
    const { runImportAction } = await import("./actions");
    const result = await runImportAction({ module: "asset", headers, mapping, rows: [row(""), row("AST-MANUAL")], commit: true });
    expect(result).toMatchObject({ imported: 1, skipped: 1 });
    expect(result.notes).toEqual([expect.stringMatching(/complete asset reference list.*not imported/i)]);
    expect(store.assets).toEqual([expect.objectContaining({ reference: "AST-MANUAL" })]);
    expect(JSON.stringify(result)).not.toContain("private reference diagnostic");
  });

  it("discards an incomplete reference lookup if a later database page fails", async () => {
    const occupied = Array.from({ length: 1001 }, (_, index) => ({ id: String(index), organisation_id: ORG_ID, reference: `CUSTOM-${index}` }));
    const store = setup({ assetsFailFrom: 1000 }, { assets: occupied });
    const { runImportAction } = await import("./actions");
    const result = await runImportAction({ module: "asset", headers, mapping, rows: [row("")], commit: true });
    expect(result).toMatchObject({ imported: 0, skipped: 1 });
    expect(store.assets).toHaveLength(1001);
    expect(result.notes).toEqual([expect.stringMatching(/complete asset reference list/i)]);
    expect(JSON.stringify(result)).not.toContain("private page diagnostic");
  });

  it("does not trust a category match from an incomplete lookup", async () => {
    const store = setup({ categoryCount: 2 }, { asset_categories: [{ id: CATEGORY_ID, organisation_id: ORG_ID, name: "Infrastructure", position: 0 }] });
    const { runImportAction } = await import("./actions");
    const result = await runImportAction({ module: "asset", headers, mapping, rows: [row("AST-001", "Infrastructure")], commit: true });
    expect(result).toMatchObject({ imported: 0, skipped: 1 });
    expect(store.assets).toEqual([]);
    expect(store.asset_categories).toHaveLength(1);
  });

  it("reports a concurrent reference conflict safely instead of exposing database diagnostics", async () => {
    const store = setup({ assetsInsertError: { code: "23505", message: "private SQL reference detail" } });
    const { runImportAction } = await import("./actions");
    const result = await runImportAction({ module: "asset", headers, mapping, rows: [row("")], commit: true });
    expect(result).toMatchObject({ imported: 0, skipped: 1 });
    expect(result.notes).toEqual([expect.stringMatching(/AST-001.*reference.*already.*not imported/i)]);
    expect(JSON.stringify(result)).not.toContain("private SQL reference detail");
    expect(store.assets).toEqual([]);
  });

});
