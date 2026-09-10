import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ missing: false, failed: false, recentCount: 0, provenanceIds: [] as string[], filters: [] as Array<[string, unknown]> }));
const id = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "workspace-1" }, membership: { role: "member" },
  supabase: { from(table: string) {
    const q = { select: () => q, order: () => q, range: () => q, limit: () => q, in: () => q,
      eq: (column: string, value: unknown) => { if (table === "evidence") state.filters.push([column, value]); return q; },
      maybeSingle: async () => table === "evidence" ? { data: state.missing ? null : { id, title: "Older linked verification", description: "Immutable older review note", kind: "note", status: "current", collected_on: "2026-01-01", valid_until: null, evidence_links: [] }, error: state.failed ? { message: "private detail" } : null } : { data: null, error: null },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "evidence" ? Array.from({ length: state.recentCount }, (_, index) => ({
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        title: `Recent evidence ${index + 1}`, kind: "note", status: "current", collected_on: "2026-09-05", valid_until: null, evidence_links: [],
      })) : [], error: null }).then(resolve),
    }; return q;
  } },
}) }));
vi.mock("@/features/github/application/github-record-provenance", () => ({
  loadOfficialGitHubEvidenceProvenance: async (_supabase: unknown, _organisationId: string, ids: string[]) => { state.provenanceIds = ids; return []; },
  parseOfficialRecordSelection: (value: string | undefined) => value ?? null,
}));
import EvidencePage from "./page";
beforeEach(() => { state.missing = false; state.failed = false; state.recentCount = 0; state.provenanceIds = []; state.filters = []; });
afterEach(cleanup);
it("loads linked evidence outside the newest 200 in the current workspace", async () => {
  render(await EvidencePage({ searchParams: Promise.resolve({ evidence: id }) }));
  expect(screen.getByRole("heading", { name: "Older linked verification" })).toBeInTheDocument();
  expect(state.filters).toContainEqual(["id", id]);
  expect(state.filters.filter(([column]) => column === "organisation_id").length).toBeGreaterThanOrEqual(2);
});
it("keeps an older selected item separate without exceeding the provenance boundary", async () => {
  state.recentCount = 200;
  const { container } = render(await EvidencePage({ searchParams: Promise.resolve({ evidence: id }) }));
  expect(state.provenanceIds).toHaveLength(200);
  expect(state.provenanceIds[0]).toBe(id);
  expect(state.provenanceIds).toContain("20000000-0000-4000-8000-000000000199");
  expect(state.provenanceIds).not.toContain("20000000-0000-4000-8000-000000000200");
  expect(container.querySelectorAll('[id^="evidence-"]')).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Older linked verification" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Recent evidence 200" })).toBeInTheDocument();
});
it("explains when selected evidence is missing or outside the workspace", async () => {
  state.missing = true;
  render(await EvidencePage({ searchParams: Promise.resolve({ evidence: id }) }));
  expect(screen.getByRole("status")).toHaveTextContent(/selected evidence.*not found.*workspace/i);
});
it("does not disguise a selected-evidence database failure as a missing record", async () => {
  state.failed = true;
  await expect(EvidencePage({ searchParams: Promise.resolve({ evidence: id }) })).rejects.toThrow("Could not load the selected evidence");
});
