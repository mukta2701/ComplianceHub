import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loadMemberMonitoring: vi.fn(),
  tables: [] as string[],
  loadControlRoom: vi.fn(),
  loadMappingReview: vi.fn(),
}));

function query() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: (table: string) => { hoisted.tables.push(table); return query(); } },
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
  GitHubComplianceControlRoomPanel: ({ role }: { role: string }) => <section aria-label="GitHub compliance control room">Read-only GitHub compliance · {role}</section>,
}));

import MonitoringPage from "./page";

describe("Member monitoring page branch", () => {
  it("returns the Member-safe view before loading source config or alert channels", async () => {
    hoisted.tables = [];
    hoisted.loadMemberMonitoring.mockResolvedValue({ connectedSystems: [], findings: [], officialGitHubFindings: [] });
    hoisted.loadControlRoom.mockResolvedValue({ repositories: [], pagination: { offset: 0, limit: 20, total: 0, truncated: false } });
    hoisted.loadMappingReview.mockResolvedValue({ pack: {}, entries: [], approvalHistory: [], limitations: [] });

    render(await MonitoringPage());

    expect(screen.getByRole("heading", { name: "Continuous monitoring" })).toBeInTheDocument();
    expect(hoisted.loadMemberMonitoring).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(hoisted.tables).toEqual(["github_installations", "github_repository_shadow_summaries"]);
    expect(screen.getByRole("region", { name: "GitHub compliance control room" })).toHaveTextContent("Read-only GitHub compliance · member");
  });
});
