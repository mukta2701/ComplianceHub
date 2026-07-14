import { describe, expect, it, vi } from "vitest";
import { loadReadinessInput } from "./load-readiness";

const ORGANISATION_ID = "74000000-0000-4000-8000-000000000001";

describe("loadReadinessInput active workspace scope", () => {
  it("filters every report source to the active organisation", async () => {
    const scopedTables: string[] = [];
    const from = vi.fn((table: string) => {
      const result = table === "soa_registers"
        ? { data: null, count: null, error: null }
        : { data: [], count: 0, error: null };
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((column: string, value: unknown) => {
        if (column === "organisation_id" && value === ORGANISATION_ID) scopedTables.push(table);
        return chain;
      });
      for (const method of ["order", "limit", "in", "neq", "not", "lt"]) chain[method] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(() => Promise.resolve(result));
      chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    });

    await loadReadinessInput({ from } as never, ORGANISATION_ID);

    expect(scopedTables.sort()).toEqual([
      "audit_findings",
      "audits",
      "evidence",
      "risk_matrix_config",
      "risks",
      "soa_registers",
      "tasks",
      "tasks",
    ].sort());
  });

  it("fails closed when the latest-register lookup fails", async () => {
    const result = { data: null, count: null, error: { message: "register unavailable" } };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "in", "neq", "not", "lt"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    const supabase = { from: vi.fn(() => chain) };

    await expect(loadReadinessInput(supabase as never, ORGANISATION_ID)).rejects.toThrow("Could not load the readiness report");
  });

  it("fails closed when any metric query fails instead of substituting zero", async () => {
    const from = vi.fn((table: string) => {
      const result = table === "risks"
        ? { data: null, count: null, error: { message: "risk query failed" } }
        : table === "soa_registers"
          ? { data: null, count: null, error: null }
          : { data: [], count: 0, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit", "in", "neq", "not", "lt"]) chain[method] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn().mockResolvedValue(result);
      chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    });

    await expect(loadReadinessInput({ from } as never, ORGANISATION_ID)).rejects.toThrow("Could not load the readiness report");
  });
});
