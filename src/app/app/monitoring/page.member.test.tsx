import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loadMemberMonitoring: vi.fn(),
  from: vi.fn(),
  loadControlRoom: vi.fn(),
  loadMappingReview: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: hoisted.from },
    organisation: { id: "org-1", name: "Example Ltd" },
    membership: { role: "member" },
  }),
}));
vi.mock("@/features/monitoring/application/load-member-monitoring", () => ({
  loadMemberMonitoring: hoisted.loadMemberMonitoring,
}));
vi.mock("@/features/monitoring/application/monitor-registry", () => ({
  resolveMonitorProvider: vi.fn(() => { throw new Error("Provider config loaded for Member"); }),
}));
vi.mock("@/features/github/application/github-compliance-control-room", () => ({
  loadGitHubComplianceControlRoom: hoisted.loadControlRoom,
}));
vi.mock("@/features/github/application/github-mapping-review", () => ({
  loadGitHubMappingReview: hoisted.loadMappingReview,
}));
vi.mock("@/features/github/components/github-compliance-control-room", () => ({
  GitHubComplianceControlRoomPanel: ({ role }: { role: string }) => <section aria-label="Technical GitHub review">Read-only technical review · {role}</section>,
}));
vi.mock("@/features/github/components/github-collection-health-panel", () => ({
  GitHubCollectionHealthPanel: ({ role }: { role: string }) =>
    <section aria-label="GitHub monitoring">{role === "owner" ? "Owner check" : "Read-only monitoring"}</section>,
}));

import MonitoringPage from "./page";

describe("Member monitoring page branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.from.mockImplementation((table: string) => {
      throw new Error(`Provider table queried for Member: ${table}`);
    });
  });

  it("loads only the Member-safe monitoring projection and renders no provider diagnostics", async () => {
    hoisted.loadMemberMonitoring.mockResolvedValue({ connectedSystems: [], findings: [], officialGitHubFindings: [] });

    render(await MonitoringPage());

    expect(screen.getByRole("heading", { name: "Continuous monitoring" })).toBeInTheDocument();
    expect(hoisted.loadMemberMonitoring).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(hoisted.from).not.toHaveBeenCalled();
    expect(hoisted.loadControlRoom).not.toHaveBeenCalled();
    expect(hoisted.loadMappingReview).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "GitHub monitoring" })).not.toBeInTheDocument();
    expect(screen.queryByText("Technical review and recovery")).not.toBeInTheDocument();
  });

  it("keeps a safe official GitHub finding visible without loading connection state", async () => {
    const findingId = "74000000-0000-4000-8000-000000000001";
    hoisted.loadMemberMonitoring.mockResolvedValue({
      connectedSystems: [{ id: "source-1", provider: "github", label: "Legacy GitHub", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: [{
        id: findingId, controlRef: "A.8.32", severity: "high", title: "Provider title must stay hidden",
        detail: "Provider detail must stay hidden.", status: "open", detectedAt: "2026-08-25T08:00:00.000Z", origin: "github",
      }],
      officialGitHubFindings: [{
        findingId,
        repository: { id: "75000000-0000-4000-8000-000000000001", name: "mukta2701/ComplianceHub", url: "https://github.com/mukta2701/ComplianceHub" },
        checkId: "github.branch.force_pushes",
        catalogueSummary: "A verified issue was materialised as an approved finding.",
        observedAt: "2026-08-25T08:00:00.000Z", freshUntil: "2026-08-26T08:00:00.000Z", materialisedAt: "2026-08-25T08:01:00.000Z",
        freshness: "current", ruleVersion: "github-repository-v1", mappingVersion: "github-iso-27001-v1", mappingChecksum: "b".repeat(64),
        isoControlReferences: ["A.8.25"], severity: "high", firstDetectedAt: "2026-08-24T08:00:00.000Z", mostRecentDetectedAt: "2026-08-25T08:00:00.000Z",
        allowedTransitions: ["acknowledged", "in_progress", "exception_requested", "risk_accepted"],
      }],
    });

    render(await MonitoringPage());

    expect(screen.getByRole("article", { name: "GitHub finding: Force pushes are allowed" })).toBeInTheDocument();
    expect(hoisted.from).not.toHaveBeenCalled();
    expect(hoisted.loadControlRoom).not.toHaveBeenCalled();
    expect(hoisted.loadMappingReview).not.toHaveBeenCalled();
    expect(screen.queryByText("Legacy GitHub")).not.toBeInTheDocument();
  });
});
