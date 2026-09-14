import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OFFICIAL = "40000000-0000-4000-8000-000000000001";
const LEGACY = "40000000-0000-4000-8000-000000000002";
const hoisted = vi.hoisted(() => ({ loadOfficial: vi.fn(), loadControlRoom: vi.fn(), loadMappingReview: vi.fn() }));

const findings = [{
  id: OFFICIAL, control_ref: "A.8.25", subject_id: "provider-subject-must-stay-hidden", severity: "high",
  title: "Provider title must stay hidden", detail: "Provider detail must stay hidden.", status: "open", task_id: null,
  detected_at: "2026-08-25T08:00:00.000Z", finding_origin: "github",
}, {
  id: LEGACY, control_ref: "A.5.7", subject_id: "legacy-subject", severity: "medium",
  title: "Legacy monitoring finding", detail: "Legacy detail remains visible.", status: "open", task_id: null,
  detected_at: "2026-08-24T08:00:00.000Z", finding_origin: "legacy",
}];

function query(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: (table: string) => query(table === "monitoring_findings" ? findings : []) },
    organisation: { id: "20000000-0000-4000-8000-000000000001" },
    membership: { role: "owner" },
  }),
}));
vi.mock("@/features/github/application/github-record-provenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/github/application/github-record-provenance")>();
  return { ...actual, loadOfficialGitHubFindingProvenance: hoisted.loadOfficial };
});
vi.mock("@/features/github/application/github-compliance-control-room", () => ({
  loadGitHubComplianceControlRoom: hoisted.loadControlRoom,
}));
vi.mock("@/features/github/application/github-mapping-review", () => ({
  loadGitHubMappingReview: hoisted.loadMappingReview,
}));
vi.mock("@/features/github/components/github-compliance-control-room", () => ({
  GitHubComplianceControlRoomPanel: () => <section aria-label="GitHub compliance control room" />,
}));
vi.mock("@/features/github/components/github-collection-health-panel", () => ({
  GitHubCollectionHealthPanel: ({ role }: { role: string }) =>
    <section aria-label="GitHub monitoring">{role === "owner" ? "Owner check" : "Read-only monitoring"}</section>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import MonitoringPage from "./page";

const provenance = {
  findingId: OFFICIAL,
  repository: { id: "50000000-0000-4000-8000-000000000001", name: "mukta2701/ComplianceHub", url: "https://github.com/mukta2701/ComplianceHub" },
  checkId: "github.branch.force_pushes", catalogueSummary: "A verified issue was materialised as an approved finding.",
  observedAt: "2026-08-25T08:00:00.000Z", freshUntil: "2026-08-26T08:00:00.000Z", materialisedAt: "2026-08-25T08:01:00.000Z",
  freshness: "current" as const, ruleVersion: "github-repository-v1", mappingVersion: "github-iso-27001-v1", mappingChecksum: "b".repeat(64),
  isoControlReferences: ["A.8.25"], severity: "high" as const, firstDetectedAt: "2026-08-24T08:00:00.000Z", mostRecentDetectedAt: "2026-08-25T08:00:00.000Z",
  allowedTransitions: ["acknowledged", "in_progress", "exception_requested", "risk_accepted"] as const,
};

describe("MonitoringPage official GitHub findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadOfficial.mockResolvedValue([provenance]);
    hoisted.loadControlRoom.mockResolvedValue({ repositories: [], pagination: { offset: 0, limit: 20, total: 0, truncated: false } });
    hoisted.loadMappingReview.mockResolvedValue({ pack: {}, entries: [], approvalHistory: [], limitations: [] });
  });

  it("selects exact official finding, renders safe Owner lifecycle, and preserves legacy controls", async () => {
    render(await MonitoringPage({ searchParams: Promise.resolve({ finding: OFFICIAL }) }));

    const official = screen.getByRole("article", { name: "GitHub finding: Force pushes are allowed" });
    expect(official).toHaveAttribute("aria-current", "true");
    expect(within(official).getByRole("button", { name: "Update review state" })).toBeInTheDocument();
    expect(within(official).getByRole("button", { name: "Raise remediation task" })).toBeInTheDocument();
    expect(within(official).queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
    expect(screen.queryByText("Provider title must stay hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("Provider detail must stay hidden.")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "GitHub monitoring" })).toHaveTextContent("Owner check");
    expect(within(official).getByText("Force pushes are allowed")).toBeVisible();
    expect(within(official).getByText("Block force pushes on the default branch.")).toBeVisible();
    expect(within(official).getByText("Technical evidence").closest("details")).not.toHaveAttribute("open");
    expect(within(official).getByText("github.branch.force_pushes")).not.toBeVisible();
    expect(within(official).getByText("b".repeat(64))).not.toBeVisible();

    const legacy = screen.getByText("Legacy monitoring finding").closest("li");
    expect(legacy).not.toBeNull();
    expect(within(legacy as HTMLElement).getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(within(legacy as HTMLElement).getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });

  it.each(["not-a-uuid", "40000000-0000-4000-8000-000000000099"])("does not select invalid or sibling query %s", async (finding) => {
    render(await MonitoringPage({ searchParams: Promise.resolve({ finding }) }));
    expect(screen.getByRole("article", { name: "GitHub finding: Force pushes are allowed" }))
      .not.toHaveAttribute("aria-current");
  });

  it("fails closed instead of rendering provider content when GitHub provenance is absent", async () => {
    hoisted.loadOfficial.mockResolvedValue([]);
    await expect(MonitoringPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("Could not load monitoring");
  });
});
