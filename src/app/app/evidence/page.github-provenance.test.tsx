import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const OFFICIAL = "30000000-0000-4000-8000-000000000001";
const LEGACY = "30000000-0000-4000-8000-000000000002";

const hoisted = vi.hoisted(() => ({
  load: vi.fn(),
}));

function query(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "20000000-0000-4000-8000-000000000001" },
    supabase: {
      from: (table: string) => query(table === "evidence" ? [{
        id: OFFICIAL, title: "Provider text must not render", kind: "link", url: "https://github.com/untrusted/value",
        storage_path: null, status: "current", collected_on: "2026-08-25", valid_until: "2026-08-26",
        source_id: null, evidence_sources: null, evidence_links: [],
      }, {
        id: LEGACY, title: "Legacy policy evidence", kind: "link", url: "https://example.com/evidence",
        storage_path: null, status: "current", collected_on: "2026-08-24", valid_until: "2026-09-24",
        source_id: null, evidence_sources: null, evidence_links: [],
      }] : []),
    },
  }),
}));
vi.mock("@/features/github/application/github-record-provenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/github/application/github-record-provenance")>();
  return { ...actual, loadOfficialGitHubEvidenceProvenance: hoisted.load };
});

import EvidencePage from "./page";

const provenance = {
  evidenceId: OFFICIAL,
  repository: { id: "50000000-0000-4000-8000-000000000001", name: "mukta2701/ComplianceHub", url: "https://github.com/mukta2701/ComplianceHub" },
  checkId: "github.branch.force_pushes",
  catalogueSummary: "A verified technical pass was materialised as approved evidence.",
  observedAt: "2026-08-25T08:00:00.000Z",
  freshUntil: "2026-08-26T08:00:00.000Z",
  materialisedAt: "2026-08-25T08:01:00.000Z",
  freshness: "current" as const,
  ruleVersion: "github-repository-v1",
  mappingVersion: "github-iso-27001-v1",
  mappingChecksum: "b".repeat(64),
  isoControlReferences: ["A.8.25"],
};

describe("EvidencePage official GitHub records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.load.mockResolvedValue([provenance]);
  });

  it("selects an exact active-workspace official record, hides its mutations, and preserves legacy evidence controls", async () => {
    render(await EvidencePage({ searchParams: Promise.resolve({ evidence: OFFICIAL }) }));

    const official = screen.getByRole("article", { name: "Official GitHub evidence github.branch.force_pushes" });
    expect(official).toHaveAttribute("aria-current", "true");
    expect(within(official).queryByText("Provider text must not render")).not.toBeInTheDocument();
    expect(within(official).queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
    expect(within(official).queryByRole("link", { name: "Supersede" })).not.toBeInTheDocument();

    const legacyHeading = screen.getByRole("heading", { name: "Legacy policy evidence" });
    const legacyCard = legacyHeading.closest(".card");
    expect(legacyCard).not.toBeNull();
    expect(within(legacyCard as HTMLElement).getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(within(legacyCard as HTMLElement).getByRole("link", { name: "Supersede" })).toBeInTheDocument();
    expect(within(legacyCard as HTMLElement).getByRole("combobox", { name: "Link Legacy policy evidence to a control" })).toBeInTheDocument();
  });

  it.each(["not-a-uuid", "30000000-0000-4000-8000-000000000099"])("treats invalid or sibling selection %s as no selection", async (evidence) => {
    render(await EvidencePage({ searchParams: Promise.resolve({ evidence }) }));
    expect(screen.getByRole("article", { name: "Official GitHub evidence github.branch.force_pushes" }))
      .not.toHaveAttribute("aria-current");
  });

  it("styles only server-validated selection state, not an arbitrary fragment target", () => {
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
    expect(css).toContain('.github-official-record[data-selected="true"]');
    expect(css).not.toContain(".github-official-record:target");
  });
});
