import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data: unknown;
  count?: number | null;
  error?: { message: string } | null;
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
  lt() { return this; }
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
      { data: null, count: 2 },
    ],
    policies: [
      { data: [] },
      { data: null, count: 0 },
      { data: null, count: 0 },
    ],
    tasks: [{ data: [] }, { data: null, count: 0 }],
    audit_events: [{ data: [] }],
    risks: [
      { data: [] },
      { data: null, count: 0 },
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
  it("does not present an empty risk posture when open risks cannot be loaded", async () => {
    hoisted.responses.risks[0] = { data: null, error: { message: "private database error" } };

    await expect(AppHome()).rejects.toThrow("Could not load dashboard");
  });

  it.each([
    ["pending SoA decisions", () => {
      hoisted.responses.soa_registers[0] = { data: { id: "soa-1" } };
      hoisted.responses.soa_items = [
        { data: null, error: { message: "private database error" } },
        { data: [] },
      ];
    }],
    ["stale evidence actions", () => { hoisted.responses.evidence[0] = { data: null, error: { message: "private database error" } }; }],
    ["policy approvals", () => { hoisted.responses.policies[0] = { data: null, error: { message: "private database error" } }; }],
    ["due work", () => { hoisted.responses.tasks[0] = { data: null, error: { message: "private database error" } }; }],
    ["recent activity", () => { hoisted.responses.audit_events[0] = { data: null, error: { message: "private database error" } }; }],
    ["evidence freshness", () => { hoisted.responses.evidence[1] = { data: null, error: { message: "private database error" } }; }],
    ["risk configuration", () => { hoisted.responses.risk_matrix_config[0] = { data: null, error: { message: "private database error" } }; }],
    ["assessment count", () => { hoisted.responses.assessment_sessions[0] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["SoA snapshot count", () => { hoisted.responses.soa_snapshots[0] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["risk count", () => { hoisted.responses.risks[1] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["evidence count", () => { hoisted.responses.evidence[2] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["policy count", () => { hoisted.responses.policies[1] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["SoA register count", () => { hoisted.responses.soa_registers[1] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["membership count", () => { hoisted.responses.memberships[0] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["open risk summary", () => { hoisted.responses.risks[2] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["overdue task summary", () => { hoisted.responses.tasks[1] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["policy review summary", () => { hoisted.responses.policies[2] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["expiring evidence summary", () => { hoisted.responses.evidence[3] = { data: null, count: null, error: { message: "private database error" } }; }],
    ["invitation count", () => { hoisted.responses.invitations[0] = { data: null, count: null, error: { message: "private database error" } }; }],
  ])("fails closed when the %s cannot be loaded", async (_label, failQuery) => {
    failQuery();

    await expect(AppHome()).rejects.toThrow("Could not load dashboard");
  });

  it("keeps successful empty results and absent optional configuration valid", async () => {
    hoisted.responses.evidence = [
      { data: [], projectMachineProvenance: true },
      { data: [] },
      { data: null, count: 0 },
      { data: null, count: 0 },
    ];

    render(await AppHome());

    expect(screen.getByText("No priority items are shown. Review All tasks for the full work list, including tasks without due dates.")).toBeVisible();
    expect(screen.getByText("Residual exposure — no open risks yet")).toBeVisible();
    expect(screen.getByText("Nothing has changed yet. Activity shows here as you and your team make decisions.")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Start assessment" })).toHaveLength(2);
  });

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


describe("Dashboard maturity clarity", () => {
  it("distinguishes missing SoA data from a measured zero", async () => {
    const { container } = render(await AppHome());
    expect(screen.getByRole("heading", { name: "Control maturity score" })).toBeVisible();
    expect(container.querySelector(".g-pct")).toHaveTextContent("—");
    expect(screen.getByText("No controls to score")).toBeVisible();
  });

  it("explains the weighted denominator including undecided controls", async () => {
    hoisted.responses.soa_registers[0] = { data: { id: "soa-1" } };
    hoisted.responses.soa_items = [{ data: [] }, { data: [
      { status: "advanced" }, { status: "pending" }, { status: "not_applicable" },
    ] }];
    const { container } = render(await AppHome());
    expect(container.querySelector(".g-pct")).toHaveTextContent("50%");
    expect(screen.getByText(/2 controls scored · 1 excluded as not applicable/)).toBeVisible();
    fireEvent.click(screen.getByText("How this score works"));
    expect(screen.getByText(/Pending decisions count as zero/)).toBeVisible();
  });

  it("does not assign a score when all controls are excluded", async () => {
    hoisted.responses.soa_registers[0] = { data: { id: "soa-1" } };
    hoisted.responses.soa_items = [{ data: [] }, { data: [{ status: "not_applicable" }] }];
    const { container } = render(await AppHome());
    expect(container.querySelector(".g-pct")).toHaveTextContent("—");
    expect(screen.getByText(/All controls are marked not applicable/)).toBeVisible();
  });

  it("does not turn full maturity into audit assurance", async () => {
    hoisted.responses.soa_registers[0] = { data: { id: "soa-1" } };
    hoisted.responses.soa_items = [{ data: [] }, { data: [{ status: "advanced" }] }];
    const { container } = render(await AppHome());
    expect(container.querySelector(".g-pct")).toHaveTextContent("100%");
    expect(screen.queryByText(/^(Almost audit-ready|Audit-ready)$/)).not.toBeInTheDocument();
    expect(screen.getByText(/Does not verify evidence or audit readiness/)).toBeVisible();
  });

  it.each(["register", "statuses"])("does not show a zero score after a failed %s query", async (query) => {
    if (query === "register") hoisted.responses.soa_registers[0] = { data: null, error: { message: "private database error" } };
    else {
      hoisted.responses.soa_registers[0] = { data: { id: "soa-1" } };
      hoisted.responses.soa_items = [{ data: [] }, { data: null, error: { message: "private database error" } }];
    }
    await expect(AppHome()).rejects.toThrow("Could not load dashboard control maturity");
  });

  it("opens the specific stale evidence and presents task provenance once", async () => {
    hoisted.responses.tasks = [{ data: [{ id: "task-1", title: "Review access", due_on: "2026-01-01", source: "manual", owner_id: null }] }, { data: null, count: 1 }];
    render(await AppHome());
    expect(screen.getByText("Refresh evidence: Manual policy proof").closest("a")).toHaveAttribute("href", "/app/evidence?evidence=manual-evidence");
    expect(screen.getAllByText("Added manually")).toHaveLength(1);
  });

  it("presents export activity without duplicate machine labels", async () => {
    hoisted.responses.audit_events = [{ data: [{ action: "export", entity_type: "export", occurred_at: "2026-09-06T09:00:00Z" }] }];
    render(await AppHome());
    expect(screen.getByText("Export generated")).toBeVisible();
    expect(screen.queryByText("export · export")).not.toBeInTheDocument();
  });
});


describe("Programme overview attention summaries", () => {
  it("keeps programme setup contextual instead of presenting baseline jargon as a top-level action", async () => {
    render(await AppHome());
    expect(screen.queryByRole("link", { name: "Continue your baseline" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review programme scope" })).toHaveAttribute("href", "/app/baseline");
    expect(screen.getByRole("link", { name: "View report" })).toHaveAttribute("href", "/app/reports/readiness");
  });

  it("uses workspace counts rather than the truncated chart and action rows", async () => {
    hoisted.responses.risks[2] = { data: null, count: 612 };
    hoisted.responses.tasks[1] = { data: null, count: 37 };
    hoisted.responses.policies[2] = { data: null, count: 29 };
    hoisted.responses.evidence[3] = { data: null, count: 3012 };
    render(await AppHome());
    const summary = screen.getByRole("navigation", { name: "Programme attention" });
    expect(within(summary).getByRole("link", { name: /Open risks/ })).toHaveTextContent("612");
    expect(within(summary).getByRole("link", { name: /Overdue tasks/ })).toHaveTextContent("37");
    expect(within(summary).getByRole("link", { name: /Policies in review/ })).toHaveTextContent("29");
    expect(within(summary).getByRole("link", { name: /Evidence expiring/ })).toHaveTextContent("3,012");
    expect(within(summary).getByRole("link", { name: /Overdue tasks/ })).toHaveAttribute("href", "/app/tasks?filter=overdue");
  });
});


it("keeps missing attention counts visibly unknown", async () => {
  hoisted.responses.tasks[1] = { data: null, count: null };
  render(await AppHome());
  expect(screen.getByRole("link", { name: /Overdue tasks/ })).toHaveTextContent("Count unavailable");
});

it("labels unscored open risks rather than describing the workspace as risk-free", async () => {
  hoisted.responses.risks[0] = { data: [{ likelihood: null, impact: null, residual_likelihood: null, residual_impact: null }] };
  hoisted.responses.risks[2] = { data: null, count: 1 };
  render(await AppHome());
  expect(screen.getByText("1 shown risk has no complete score")).toBeVisible();
  expect(screen.queryByText("Residual exposure — no open risks yet")).not.toBeInTheDocument();
});
