import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ loadOfficial: vi.fn().mockResolvedValue([]) }));
vi.mock("@/features/github/application/github-record-provenance", () => ({
  loadOfficialGitHubFindingProvenance: hoisted.loadOfficial,
}));

import { loadMemberMonitoring } from "./load-member-monitoring";

const ORGANISATION_ID = "73000000-0000-4000-8000-000000000001";

function query(result: { data: unknown; error: unknown }) {
  const select = vi.fn();
  const chain: Record<string, unknown> = { select };
  select.mockImplementation(() => chain);
  for (const method of ["eq", "in", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

describe("loadMemberMonitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadOfficial.mockResolvedValue([]);
  });

  it("loads safe source summaries and active findings without source configuration", async () => {
    const findingQuery = query({
      data: [{
        id: "74000000-0000-4000-8000-000000000001",
        control_ref: "A.8.32",
        severity: "high",
        title: "Branch protection disabled",
        detail: "The default branch is not protected.",
        finding_origin: "legacy",
        status: "open",
        detected_at: "2026-01-03T00:00:00Z",
      }, {
        id: "74000000-0000-4000-8000-000000000002",
        control_ref: "A.8.32",
        severity: "medium",
        title: "Exception review",
        detail: "The technical condition remains unresolved.",
        finding_origin: "legacy",
        status: "exception_requested",
        detected_at: "2026-01-04T00:00:00Z",
      }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table !== "monitoring_findings") throw new Error(`Sensitive or unexpected table: ${table}`);
      return findingQuery;
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "73000000-0000-4000-8000-000000000010", provider: "github", label: "Production GitHub", connected_at: "2026-01-01T00:00:00Z" }],
      error: null,
    });

    await expect(loadMemberMonitoring({ from, rpc } as never, ORGANISATION_ID)).resolves.toEqual({
      connectedSystems: [{ id: "73000000-0000-4000-8000-000000000010", provider: "github", label: "Production GitHub", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: [{
        id: "74000000-0000-4000-8000-000000000001",
        controlRef: "A.8.32",
        severity: "high",
        title: "Branch protection disabled",
        detail: "The default branch is not protected.",
        origin: "legacy",
        status: "open",
        detectedAt: "2026-01-03T00:00:00Z",
      }, {
        id: "74000000-0000-4000-8000-000000000002",
        controlRef: "A.8.32",
        severity: "medium",
        title: "Exception review",
        detail: "The technical condition remains unresolved.",
        origin: "legacy",
        status: "exception_requested",
        detectedAt: "2026-01-04T00:00:00Z",
      }],
      officialGitHubFindings: [],
    });

    expect(from).toHaveBeenCalledWith("monitoring_findings");
    expect(findingQuery.select).toHaveBeenCalledWith("id,control_ref,severity,title,detail,status,detected_at,finding_origin");
    expect(findingQuery.in).toHaveBeenCalledWith("status", [
      "open", "acknowledged", "in_progress", "exception_requested", "risk_accepted",
    ]);
    expect(rpc).toHaveBeenCalledWith("list_connected_monitor_sources", { target_organisation_id: ORGANISATION_ID });
    expect(hoisted.loadOfficial).toHaveBeenCalledWith(expect.anything(), ORGANISATION_ID, []);
  });

  it("fails safely rather than mixing partial monitoring state", async () => {
    const failed = query({ data: null, error: { message: "provider secret" } });
    const supabase = { from: vi.fn(() => failed), rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };

    await expect(loadMemberMonitoring(supabase as never, ORGANISATION_ID)).rejects.toThrow("Could not load member monitoring");
  });

  it("rejects unexpected source or finding fields before official provenance loading", async () => {
    const findingQuery = query({
      data: [{
        id: "74000000-0000-4000-8000-000000000001", control_ref: "A.8.32", severity: "high",
        title: "Safe title", detail: "Safe detail", status: "open", detected_at: "2026-01-03T00:00:00.000Z",
        finding_origin: "legacy",
        provider_body: "must not cross the member boundary",
      }],
      error: null,
    });
    const supabase = {
      from: vi.fn(() => findingQuery),
      rpc: vi.fn().mockResolvedValue({
        data: [{ id: "73000000-0000-4000-8000-000000000010", provider: "github", label: "GitHub", connected_at: "2026-01-01T00:00:00.000Z", config: { secret: true } }],
        error: null,
      }),
    };

    await expect(loadMemberMonitoring(supabase as never, ORGANISATION_ID)).rejects.toThrow("Could not load member monitoring");
    expect(hoisted.loadOfficial).not.toHaveBeenCalled();
  });

  it("fails closed when a GitHub-origin finding has no trusted provenance", async () => {
    const findingQuery = query({
      data: [{
        id: "74000000-0000-4000-8000-000000000001", control_ref: "A.8.32", severity: "high",
        title: "Provider title", detail: "Provider detail", status: "open",
        detected_at: "2026-01-03T00:00:00.000Z", finding_origin: "github",
      }],
      error: null,
    });
    const supabase = {
      from: vi.fn(() => findingQuery),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    hoisted.loadOfficial.mockResolvedValue([]);

    await expect(loadMemberMonitoring(supabase as never, ORGANISATION_ID))
      .rejects.toThrow("Could not load member monitoring");
  });
});
