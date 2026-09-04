import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data: unknown;
  count?: number | null;
  projectMachineProvenance?: boolean;
};

const hoisted = vi.hoisted(() => ({
  responses: {} as Record<string, QueryResult[]>,
}));

class Query implements PromiseLike<QueryResult> {
  private selection = "";
  private excludesMachineProvenance = false;
  private resultLimit: number | null = null;

  constructor(private readonly result: QueryResult) {}

  select(columns: string) { this.selection = columns; return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  not() { return this; }
  is(column: string, value: unknown) {
    if (column === "machine_provenance" && value === null) this.excludesMachineProvenance = true;
    return this;
  }
  order() { return this; }
  limit(value: number) { this.resultLimit = value; return this; }
  maybeSingle() { return this; }

  private resolved(): QueryResult {
    if (!this.result.projectMachineProvenance || !Array.isArray(this.result.data)) return this.result;
    const rows = this.excludesMachineProvenance
      ? this.result.data.filter((row) => (
          typeof row === "object" && row !== null
          && Array.isArray((row as Record<string, unknown>).machine_provenance)
          && ((row as Record<string, unknown>).machine_provenance as unknown[]).length === 0
        ))
      : this.result.data;
    const limited = rows.slice(0, this.resultLimit ?? rows.length);
    const includesProvenance = this.selection.includes("machine_provenance:");
    return {
      ...this.result,
      data: limited.map((row) => {
        if (includesProvenance || typeof row !== "object" || row === null) return row;
        const projected = { ...row } as Record<string, unknown>;
        delete projected.machine_provenance;
        return projected;
      }),
    };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolved()).then(onfulfilled, onrejected);
  }
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: {
      from: (table: string) => {
        const result = hoisted.responses[table]?.shift();
        if (!result) throw new Error(`Unexpected dashboard query for ${table}`);
        return new Query(result);
      },
    },
    user: { id: "owner-1" },
    membership: { role: "owner", job_title: "Founder" },
    organisation: { id: "org-1", name: "Example Ltd" },
  }),
}));
vi.mock("./tasks/actions", () => ({ acceptCalendarSeedAction: vi.fn() }));

import AppHome from "./page";

beforeEach(() => {
  hoisted.responses = {
    soa_registers: [
      { data: null },
      { data: null, count: 0 },
    ],
    evidence: [
      {
        data: [
          {
            id: "github-evidence", title: "GitHub branch protection", status: "expiring",
            valid_until: "2026-09-05", machine_provenance: [{ evidence_id: "github-evidence" }],
          },
          {
            id: "manual-evidence", title: "Manual policy proof", status: "expiring",
            valid_until: "2026-09-06", machine_provenance: [],
          },
        ],
        projectMachineProvenance: true,
      },
      { data: [{ status: "expiring" }, { status: "expiring" }] },
      { data: null, count: 2 },
    ],
    policies: [
      { data: [] },
      { data: null, count: 0 },
    ],
    tasks: [{ data: [] }],
    audit_events: [{ data: [] }],
    risks: [
      { data: [] },
      { data: null, count: 0 },
    ],
    risk_matrix_config: [{ data: null }],
    assessment_sessions: [{ data: null, count: 0 }],
    soa_snapshots: [{ data: null, count: 0 }],
    memberships: [{ data: null, count: 1 }],
    invitations: [{ data: null, count: 0 }],
    integration_connections: [{ data: null, count: 1 }],
  };
});

describe("Owner dashboard", () => {
  it("counts GitHub evidence freshness without presenting it as human replacement work", async () => {
    render(await AppHome());

    expect(screen.getByText("2 items in your vault")).toBeVisible();
    expect(screen.getByText("Refresh evidence: Manual policy proof")).toBeVisible();
    expect(screen.queryByText("Refresh evidence: GitHub branch protection")).not.toBeInTheDocument();
  });

  it("finds manual replacement work even when machine evidence fills the query limit", async () => {
    const machineRows = Array.from({ length: 25 }, (_, index) => ({
      id: `github-evidence-${index}`,
      title: `GitHub evidence ${index}`,
      status: "expiring",
      valid_until: "2026-09-05",
      machine_provenance: [{ evidence_id: `github-evidence-${index}` }],
    }));
    hoisted.responses.evidence[0] = {
      data: [
        ...machineRows,
        {
          id: "manual-evidence", title: "Manual proof beyond machine rows", status: "expiring",
          valid_until: "2026-09-06", machine_provenance: [],
        },
      ],
      projectMachineProvenance: true,
    };

    render(await AppHome());

    expect(screen.getByText("Refresh evidence: Manual proof beyond machine rows")).toBeVisible();
  });
});
