import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  ranges: [] as Array<[number, number]>,
  conditions: [] as string[],
  rows: [] as typeof record[],
  counts: { all: 201, current: 180, expiring: 11, expired: 10, history: 0 },
}));

const record = {
  id: "11111111-1111-4111-8111-111111111111", title: "Access review export",
  description: "Reviewed access list", kind: "note", url: null, storage_path: null,
  status: "current", collected_on: "2026-09-01", valid_until: "2026-12-01",
  source_id: null, observation_key: null, external_ref: null, evidence_sources: null, evidence_links: [],
};

function builder(table: string) {
  let options: { count?: string; head?: boolean } | undefined;
  let status: string | undefined;
  let condition = "";
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((_columns: string, nextOptions?: typeof options) => { options = nextOptions; return chain; });
  chain.eq = vi.fn((column: string, value: string) => { if (column === "status") status = value; return chain; });
  chain.in = vi.fn((column: string, values: string[]) => { if (column === "status" && values.includes("superseded")) status = "history"; return chain; });
  chain.or = vi.fn((value: string) => { condition = value; calls.conditions.push(value); return chain; });
  chain.order = vi.fn(() => chain);
  chain.range = vi.fn((from: number, to: number) => { calls.ranges.push([from, to]); return chain; });
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (resolve: (value: unknown) => unknown) => {
    if (table !== "evidence") return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
    if (options?.head) {
      const count = status === "current" ? calls.counts.current : condition.includes("status.eq.expired") ? calls.counts.expired : condition.includes("status.eq.expiring") ? calls.counts.expiring : status === "history" ? calls.counts.history : calls.counts.all;
      return Promise.resolve({ data: null, error: null, count }).then(resolve);
    }
    return Promise.resolve({ data: calls.rows, error: null }).then(resolve);
  };
  return chain;
}

vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org-1" }, membership: { role: "admin" },
  supabase: { from: (table: string) => builder(table) },
}) }));
vi.mock("@/features/github/application/github-record-provenance", () => ({
  loadOfficialGitHubEvidenceProvenance: vi.fn().mockResolvedValue([]),
  parseOfficialRecordSelection: vi.fn().mockReturnValue(null),
}));

import EvidencePage from "./page";

afterEach(() => { cleanup(); calls.ranges = []; calls.conditions = []; calls.rows = [record]; calls.counts = { all: 201, current: 180, expiring: 11, expired: 10, history: 0 }; });

it("reports exact workspace totals while rendering one bounded page", async () => {
  calls.rows = [record];
  render(await EvidencePage({ searchParams: Promise.resolve({}) }));

  expect(screen.getByText("180")).toBeInTheDocument();
  expect(screen.getByText("11")).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByText(/Showing 1–25 of 201 evidence records/)).toBeInTheDocument();
  expect(calls.ranges).toContainEqual([0, 24]);
  expect(calls.conditions.some((value) => value.includes("valid_until.lt"))).toBe(true);
});

it("clamps an out-of-range page to the final valid page", async () => {
  calls.rows = [record];
  render(await EvidencePage({ searchParams: Promise.resolve({ page: "999" }) }));
  expect(calls.ranges).toContainEqual([200, 224]);
  expect(screen.getByText("Page 9 of 9")).toBeInTheDocument();
  expect(screen.getByText(/Showing 201–201 of 201 evidence records/)).toBeInTheDocument();
});

it("distinguishes an empty filter from a workspace with no evidence", async () => {
  calls.counts.expired = 0;
  calls.rows = [];
  render(await EvidencePage({ searchParams: Promise.resolve({ status: "expired" }) }));
  expect(screen.getByText("No evidence matches this freshness filter.")).toBeInTheDocument();
  expect(screen.queryByText("Add your first evidence")).not.toBeInTheDocument();
});
