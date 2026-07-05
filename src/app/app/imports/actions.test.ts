import { describe, expect, it, vi } from "vitest";
import { riskInputSchema } from "@/features/risks/application/risk";

// runImportAction is a server action ("use server") that calls requireAppContext()
// for its Supabase client. Rather than a live DB, we mock app-context with an
// in-memory fake store — modelling only the handful of query shapes the risk
// module commit path issues (mirrors the pattern used by
// src/app/api/cron/daily/route.test.ts).

const hoisted = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type Row = Record<string, unknown>;
type Store = { risk_categories: Row[]; memberships: Row[]; risks: Row[] };

type Result = { data: unknown; error: unknown; count?: number };

// Minimal chainable query-builder fake over an in-memory store — only the
// operations runImportAction's risk-module commit path issues (select/eq,
// select-with-count-head, and plain insert).
class Builder implements PromiseLike<Result> {
  private filters: [string, unknown][] = [];
  private op: "select" | "insert" = "select";
  private payload: Row = {};
  private countHead = false;

  constructor(private rows: Row[]) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.countHead = true;
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

  private matched() {
    return this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }

  private resolve(): Result {
    if (this.op === "insert") {
      const inserted = { id: `id-${this.rows.length + 1}`, ...this.payload };
      this.rows.push(inserted);
      return { data: [inserted], error: null };
    }
    if (this.countHead) return { data: null, error: null, count: this.matched().length };
    return { data: this.matched(), error: null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(store: Store) {
  return { from: (table: keyof Store) => new Builder(store[table]) };
}

// zod's uuid() format requires valid version/variant nibbles, so these can't just be "org-1" etc.
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const CATEGORY_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";

const HEADERS = ["description", "categoryName", "likelihood", "impact"];
const MAPPING = { description: "description", categoryName: "categoryName", likelihood: "likelihood", impact: "impact" };
const validRow = (n: number) => [`Row ${n} description`, "Operational", "3", "2"];

describe("runImportAction — row cap (Fix 1)", () => {
  it("caps input.rows at MAX_IMPORT_ROWS regardless of how many the caller posts", async () => {
    hoisted.ctx = { supabase: fakeSupabase({ risk_categories: [], memberships: [], risks: [] }), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" } };
    const { runImportAction, MAX_IMPORT_ROWS } = await import("./actions");

    const oversized = Array.from({ length: MAX_IMPORT_ROWS + 137 }, (_, i) => validRow(i));
    const result = await runImportAction({ module: "risk", headers: HEADERS, rows: oversized, mapping: MAPPING, commit: false });

    expect(result.total).toBe(MAX_IMPORT_ROWS);
    expect(result.valid).toBe(MAX_IMPORT_ROWS);
    expect(result.notes).toEqual([`Import is limited to ${MAX_IMPORT_ROWS} rows per file; ${oversized.length} rows were provided.`]);
  });

  it("does not truncate (or add a note) when rows are within the ceiling", async () => {
    hoisted.ctx = { supabase: fakeSupabase({ risk_categories: [], memberships: [], risks: [] }), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" } };
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
    hoisted.ctx = { supabase: fakeSupabase(store), user: { id: USER_ID }, organisation: { id: ORG_ID, name: "Org" } };
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
