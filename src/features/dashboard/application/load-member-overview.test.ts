import { describe, expect, it, vi } from "vitest";
import { loadMemberOverview } from "./load-member-overview";

const ORGANISATION_ID = "72000000-0000-4000-8000-000000000001";

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit", "maybeSingle"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

describe("loadMemberOverview", () => {
  it("loads only personal policy state, safe source summaries, and finding severities", async () => {
    const tables: string[] = [];
    const queries = {
      policies: query({
        data: [{ id: "policy-1", version: 3 }, { id: "policy-2", version: 2 }],
        error: null,
      }),
      policy_acceptances: query({
        data: [{ policy_id: "policy-1", accepted_version: 3 }, { policy_id: "policy-2", accepted_version: 1 }],
        error: null,
      }),
      monitoring_findings: query({
        data: [{ severity: "critical", status: "open" }, { severity: "low", status: "acknowledged" }],
        error: null,
      }),
      leadership_report_snapshots: query({
        data: { published_at: "2026-07-14T07:30:00Z" },
        error: null,
      }),
    };
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "source-1", provider: "github", label: "Production GitHub", connected_at: "2026-01-01T00:00:00Z" }],
      error: null,
    });
    const supabase = {
      from: vi.fn((table: keyof typeof queries) => {
        tables.push(table);
        if (!(table in queries)) throw new Error(`Sensitive or unexpected table: ${table}`);
        return queries[table];
      }),
      rpc,
    };

    await expect(loadMemberOverview(supabase as never, {
      organisationId: ORGANISATION_ID,
      organisationName: "Example Ltd",
      jobTitle: "Developer",
    })).resolves.toEqual({
      organisationName: "Example Ltd",
      jobTitle: "Developer",
      policies: { approved: 2, acceptedCurrent: 1 },
      connectedSystems: [{ id: "source-1", provider: "github", label: "Production GitHub", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: { active: 2, highOrCritical: 1 },
      leadershipReport: { publishedAt: "2026-07-14T07:30:00Z" },
    });

    expect(tables).toEqual(["policies", "policy_acceptances", "monitoring_findings", "leadership_report_snapshots"]);
    expect(rpc).toHaveBeenCalledWith("list_connected_monitor_sources", { target_organisation_id: ORGANISATION_ID });
    expect(JSON.stringify(queries)).not.toMatch(/config|token|alert_channels|monitor_sources/);
  });

  it("fails with a safe error instead of presenting partial state", async () => {
    const failed = query({ data: null, error: { message: "database credentials" } });
    const supabase = {
      from: vi.fn(() => failed),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    await expect(loadMemberOverview(supabase as never, {
      organisationId: ORGANISATION_ID,
      organisationName: "Example Ltd",
      jobTitle: null,
    })).rejects.toThrow("Could not load the member overview");
  });
});
