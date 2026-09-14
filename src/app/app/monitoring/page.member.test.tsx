import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loadMemberMonitoring: vi.fn(),
  tables: [] as string[],
  loadControlRoom: vi.fn(),
  loadMappingReview: vi.fn(),
  rows: {} as Record<string, unknown[]>,
}));

function query(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: (table: string) => { hoisted.tables.push(table); return query(hoisted.rows[table] ?? []); } },
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
  it("returns the Member-safe view before loading source config or alert channels", async () => {
    hoisted.tables = [];
    hoisted.rows = {};
    hoisted.loadMemberMonitoring.mockResolvedValue({ connectedSystems: [], findings: [], officialGitHubFindings: [] });
    hoisted.loadControlRoom.mockResolvedValue({ repositories: [], pagination: { offset: 0, limit: 20, total: 0, truncated: false } });
    hoisted.loadMappingReview.mockResolvedValue({ pack: {}, entries: [], approvalHistory: [], limitations: [] });

    render(await MonitoringPage());

    expect(screen.getByRole("heading", { name: "Continuous monitoring" })).toBeInTheDocument();
    expect(hoisted.loadMemberMonitoring).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(hoisted.tables).toEqual(["github_installations", "github_repository_monitoring_summaries"]);
    expect(screen.getByRole("region", { name: "GitHub monitoring" })).toHaveTextContent("Read-only monitoring");
    const technical = screen.getByText("Technical review and recovery").closest("details");
    expect(technical).not.toHaveAttribute("open");
    expect(technical).toContainElement(screen.getByRole("region", { name: "Technical GitHub review" }));
  });

  it("counts active GitHub as connected for Members even when permissions need attention", async () => {
    hoisted.tables = [];
    hoisted.rows = {
      github_installations: [{
        id: "43000000-0000-4000-8000-000000000001", account_login: "ExampleOrg", status: "active",
        repository_selection: "selected", permissions_ok: false,
      }],
      github_repository_monitoring_summaries: [],
    };
    hoisted.loadMemberMonitoring.mockResolvedValue({
      connectedSystems: [{ id: "source-1", provider: "github", label: "Legacy GitHub", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: [],
      officialGitHubFindings: [],
    });
    hoisted.loadControlRoom.mockResolvedValue({ repositories: [], pagination: { offset: 0, limit: 20, total: 0, truncated: false } });
    hoisted.loadMappingReview.mockResolvedValue({ pack: {}, entries: [], approvalHistory: [], limitations: [] });

    render(await MonitoringPage());

    const banner = screen.getByText("No recorded active findings").closest(".monitor-banner");
    expect(banner).toHaveTextContent("1 system monitored");
    expect(screen.queryByText("Legacy GitHub")).not.toBeInTheDocument();
  });
});
