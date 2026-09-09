import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const rows = [
  {
    id: "keyed", title: "Keyed provider observation", kind: "note", url: null, storage_path: null,
    status: "current", collected_on: "2026-09-08", valid_until: null, source_id: "source-1",
    observation_key: "observation-1", external_ref: "repo/example/main", description: "Keyed facts", evidence_sources: null, evidence_links: [],
  },
  {
    id: "legacy", title: "Legacy provider observation", kind: "note", url: null, storage_path: null,
    status: "current", collected_on: "2026-08-01", valid_until: null, source_id: "source-1",
    observation_key: null, external_ref: "repo/example/main", description: "Legacy facts", evidence_sources: null, evidence_links: [],
  },
  {
    id: "manual", title: "Manual review note", kind: "note", url: null, storage_path: null,
    status: "current", collected_on: "2026-09-07", valid_until: null, source_id: null,
    observation_key: null, external_ref: null, description: "Manual facts", evidence_sources: null, evidence_links: [],
  },
];

function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit", "maybeSingle"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
    data: table === "evidence" ? rows : table === "ai_workspace_settings" ? null : [],
    error: null,
  }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1" }, membership: { role: "member" },
    supabase: { from: (table: string) => query(table) },
  }),
}));
vi.mock("@/features/github/application/github-record-provenance", () => ({
  loadOfficialGitHubEvidenceProvenance: vi.fn().mockResolvedValue([]),
  parseOfficialRecordSelection: vi.fn().mockReturnValue(null),
}));

import EvidencePage from "./page";

describe("EvidencePage observation identity", () => {
  it("shows keyed collection metadata and labels legacy automation identity without changing manual evidence", async () => {
    render(await EvidencePage());

    expect(screen.getByText(/Collected 2026-09-08/)).toBeInTheDocument();
    expect(screen.getAllByText(/Resource: repo\/example\/main/)).toHaveLength(2);
    expect(screen.getByText("Legacy observation identity unknown")).toBeInTheDocument();
    expect(screen.getByText("Collected 2026-09-07")).toBeInTheDocument();
    expect(screen.queryByText(/Observed .*00:00/)).not.toBeInTheDocument();
  });
});
