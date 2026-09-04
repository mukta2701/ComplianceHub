import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "evidence" ? [{ id: "e1", title: "Access review", kind: "note", url: null, storage_path: null, status: "current", collected_on: "2026-09-01", valid_until: null, source_id: null, evidence_sources: null, evidence_links: [] }] : table === "ai_workspace_settings" ? { enabled: true } : [], error: null }).then(resolve);
  return chain;
}
vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve({ organisation: { id: "org-1" }, membership: { role: "member" }, supabase: { from: (table: string) => query(table) } }) }));
vi.mock("@/features/github/application/github-record-provenance", () => ({ loadOfficialGitHubEvidenceProvenance: vi.fn().mockResolvedValue([]), parseOfficialRecordSelection: vi.fn().mockReturnValue(null) }));
import EvidencePage from "./page";

describe("EvidencePage restored AI panel", () => {
  it("shows draft only assistance while retaining Member read-only controls", async () => {
    render(await EvidencePage());
    expect(screen.getByLabelText("AI Explain and Act")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add evidence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });
});
