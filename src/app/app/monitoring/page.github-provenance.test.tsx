import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPECTED_GITHUB_CHECK_IDS } from "@/features/github/domain/rules";

const OFFICIAL = "40000000-0000-4000-8000-000000000001";
const LEGACY = "40000000-0000-4000-8000-000000000002";
const hoisted = vi.hoisted(() => ({
  loadOfficial: vi.fn(), loadControlRoom: vi.fn(), loadMappingReview: vi.fn(),
  installations: [] as unknown[], repositories: [] as unknown[],
}));

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
    supabase: { from: (table: string) => query(table === "monitoring_findings" ? findings
      : table === "github_installations" ? hoisted.installations
        : table === "github_repository_monitoring_summaries" ? hoisted.repositories : []) },
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

const repositoryId = "50000000-0000-4000-8000-000000000001";
const installationId = "60000000-0000-4000-8000-000000000001";
const collectionId = "70000000-0000-4000-8000-000000000001";
const mappingPackId = "80000000-0000-4000-8000-000000000001";
const mappingChecksum = "c".repeat(64);

function currentRoom() {
  return {
    asOf: "2026-09-24T12:00:00.000Z",
    approval: { mappingPackId, version: "github-iso-27001-v1", checksum: mappingChecksum } as {
      mappingPackId: string; version: string; checksum: string;
    } | null,
    repositories: [{
      id: repositoryId, available: true,
      latestCollection: { id: collectionId, status: "succeeded" },
      latestMaterialisationJob: { collectionRunId: collectionId, status: "completed" },
      officialResults: EXPECTED_GITHUB_CHECK_IDS.map((checkId) => ({
        checkId, outcome: "pass", observedAt: "2026-09-24T10:00:00.000Z",
        freshUntil: "2026-09-25T10:00:00.000Z",
        mappingPackId, mappingVersion: "github-iso-27001-v1", mappingChecksum,
      })),
    }],
    pagination: { offset: 0, limit: 20, total: 1, truncated: false },
  };
}

describe("MonitoringPage official GitHub findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.installations = [{ id: installationId, status: "active", permissions_ok: true, health: "healthy" }];
    hoisted.repositories = [{ repository_id: repositoryId, installation_id: installationId, available: true }];
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
    expect(within(official).getByText("Audit details").closest("details")).not.toHaveAttribute("open");
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

  it("labels expired GitHub results as saved history rather than current passes", async () => {
    hoisted.loadControlRoom.mockResolvedValue({
      asOf: "2026-09-24T12:00:00.000Z",
      repositories: [{ officialResults: [{
        outcome: "pass", freshUntil: "2026-09-22T12:00:00.000Z", observedAt: "2026-09-21T12:00:00.000Z",
      }] }],
      pagination: { offset: 0, limit: 20, total: 1, truncated: false },
    });

    render(await MonitoringPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Saved GitHub results need a new check")).toBeVisible();
    expect(screen.getByText(/1 previously passed/)).toBeVisible();
    expect(screen.queryByText(/1 passed ·/)).not.toBeInTheDocument();
  });

  it.each([
    ["approval is absent", (room: ReturnType<typeof currentRoom>) => { room.approval = null; }],
    ["mapping identity differs", (room: ReturnType<typeof currentRoom>) => { room.repositories[0].officialResults[0].mappingChecksum = "d".repeat(64); }],
    ["collection is partial", (room: ReturnType<typeof currentRoom>) => { room.repositories[0].latestCollection.status = "partial"; }],
    ["processing is pending", (room: ReturnType<typeof currentRoom>) => { room.repositories[0].latestMaterialisationJob.status = "pending"; }],
    ["processing belongs to an older run", (room: ReturnType<typeof currentRoom>) => { room.repositories[0].latestMaterialisationJob.collectionRunId = "70000000-0000-4000-8000-000000000002"; }],
    ["the check set is incomplete", (room: ReturnType<typeof currentRoom>) => { room.repositories[0].officialResults.pop(); }],
    ["the repository is unavailable", (room: ReturnType<typeof currentRoom>) => { room.repositories[0].available = false; }],
    ["the connection is unhealthy", () => { hoisted.installations = [{ id: installationId, status: "active", permissions_ok: true, health: "retrying" }]; }],
  ])("keeps future-dated passes as saved history when %s", async (_reason, invalidate) => {
    const room = currentRoom();
    invalidate(room);
    hoisted.loadControlRoom.mockResolvedValue(room);

    render(await MonitoringPage({ searchParams: Promise.resolve({}) }));

    const summary = screen.getByRole("note", { name: "GitHub check summary" });
    expect(within(summary).getByText("Saved GitHub results need review")).toBeVisible();
    expect(within(summary).getByText(`${room.repositories[0].officialResults.length} saved passes need review`)).toBeVisible();
    expect(within(summary).queryByText(/passed at last check/)).not.toBeInTheDocument();
  });

  it("counts a complete approved healthy collection as passed at the last check", async () => {
    hoisted.loadControlRoom.mockResolvedValue(currentRoom());

    render(await MonitoringPage({ searchParams: Promise.resolve({}) }));

    const summary = screen.getByRole("note", { name: "GitHub check summary" });
    expect(within(summary).getByText("15 passed at last check")).toBeVisible();
    expect(within(summary).queryByText(/certif/i)).not.toBeInTheDocument();
  });

  it("keeps counts and observation date scoped to the loaded repository page", async () => {
    const room = currentRoom();
    room.pagination = { offset: 20, limit: 20, total: 21, truncated: false };
    room.repositories[0].officialResults[0].observedAt = "2026-09-24T11:00:00.000Z";
    hoisted.loadControlRoom.mockResolvedValue(room);

    render(await MonitoringPage({ searchParams: Promise.resolve({ githubPage: "2" }) }));

    expect(hoisted.loadControlRoom).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ offset: 20, limit: 20 }));
    const summary = screen.getByRole("note", { name: "GitHub check summary" });
    expect(within(summary).getByText(/15 saved checks on this page/)).toBeVisible();
    expect(within(summary).getByText(/Most recent observation/)).toBeVisible();
    expect(summary.querySelector("time")).toHaveAttribute("dateTime", "2026-09-24T11:00:00.000Z");
    expect(within(summary).queryByText(/Last checked/)).not.toBeInTheDocument();
  });
});
