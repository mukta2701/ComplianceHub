import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ ranges: [] as Array<[number, number]> }));

const record = {
  id: "11111111-1111-4111-8111-111111111111", title: "Access review export",
  description: "Reviewed access list", kind: "note", url: null, storage_path: null,
  status: "current", collected_on: "2026-09-01", valid_until: "2026-12-01",
  source_id: null, observation_key: null, external_ref: null, evidence_sources: null, evidence_links: [],
};

function builder(table: string) {
  let options: { count?: string; head?: boolean } | undefined;
  let status: string | undefined;
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((_columns: string, nextOptions?: typeof options) => { options = nextOptions; return chain; });
  chain.eq = vi.fn((column: string, value: string) => { if (column === "status") status = value; return chain; });
  chain.in = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.range = vi.fn((from: number, to: number) => { calls.ranges.push([from, to]); return chain; });
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (resolve: (value: unknown) => unknown) => {
    if (table !== "evidence") return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
    if (options?.head) {
      const count = status === "current" ? 180 : status === "expiring" ? 11 : status === "expired" ? 10 : 0;
      return Promise.resolve({ data: null, error: null, count }).then(resolve);
    }
    return Promise.resolve({ data: [record], error: null, count: 201 }).then(resolve);
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

afterEach(() => { cleanup(); calls.ranges = []; });

it("reports exact workspace totals while rendering one bounded page", async () => {
  render(await EvidencePage({ searchParams: Promise.resolve({}) }));

  expect(screen.getByText("180")).toBeInTheDocument();
  expect(screen.getByText("11")).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByText(/Showing 1–25 of 201 evidence records/)).toBeInTheDocument();
  expect(calls.ranges).toContainEqual([0, 24]);
});
