import { describe, expect, it, vi } from "vitest";
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
  it("loads safe source summaries and active findings without source configuration", async () => {
    const findingQuery = query({
      data: [{
        id: "finding-1",
        control_ref: "A.8.32",
        severity: "high",
        title: "Branch protection disabled",
        detail: "The default branch is not protected.",
        status: "open",
        detected_at: "2026-01-03T00:00:00Z",
      }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table !== "monitoring_findings") throw new Error(`Sensitive or unexpected table: ${table}`);
      return findingQuery;
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "source-1", provider: "github", label: "Production GitHub", connected_at: "2026-01-01T00:00:00Z" }],
      error: null,
    });

    await expect(loadMemberMonitoring({ from, rpc } as never, ORGANISATION_ID)).resolves.toEqual({
      connectedSystems: [{ id: "source-1", provider: "github", label: "Production GitHub", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: [{
        id: "finding-1",
        controlRef: "A.8.32",
        severity: "high",
        title: "Branch protection disabled",
        detail: "The default branch is not protected.",
        status: "open",
        detectedAt: "2026-01-03T00:00:00Z",
      }],
    });

    expect(from).toHaveBeenCalledWith("monitoring_findings");
    expect(findingQuery.select).toHaveBeenCalledWith("id,control_ref,severity,title,detail,status,detected_at");
    expect(rpc).toHaveBeenCalledWith("list_connected_monitor_sources", { target_organisation_id: ORGANISATION_ID });
  });

  it("fails safely rather than mixing partial monitoring state", async () => {
    const failed = query({ data: null, error: { message: "provider secret" } });
    const supabase = { from: vi.fn(() => failed), rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };

    await expect(loadMemberMonitoring(supabase as never, ORGANISATION_ID)).rejects.toThrow("Could not load member monitoring");
  });
});
