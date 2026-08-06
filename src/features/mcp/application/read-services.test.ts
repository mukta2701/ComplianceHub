import { describe, expect, it, vi } from "vitest";
import { McpError } from "../auth/errors";
import {
  buildAttentionItems,
  buildLiveReadiness,
  fetchAllPages,
  parseLocalDate,
  type AttentionSourceRows,
} from "./read-services";

describe("MCP exact read helpers", () => {
  it("paginates beyond the Data API row cap without losing or duplicating rows", async () => {
    const source = Array.from({ length: 1_205 }, (_, index) => ({ id: String(index).padStart(4, "0") }));
    const page = vi.fn(async (from: number, to: number) => ({ data: source.slice(from, to + 1), error: null }));
    await expect(fetchAllPages(page, 500)).resolves.toEqual(source);
    expect(page.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it("fails closed when any page fails", async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: { message: "secret" } }), 500))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" } satisfies Partial<McpError>);
  });

  it("uses residual risk ratings and the workspace matrix while excluding closed risks", () => {
    const report = buildLiveReadiness({
      soa: [{ status: "advanced" }, { status: "not_applicable" }],
      risks: [
        { status: "open", residual_likelihood: 2, residual_impact: 3 },
        { status: "closed", residual_likelihood: 5, residual_impact: 5 },
      ],
      evidence: [
        { status: "current", valid_until: "2026-08-05" },
        { status: "current", valid_until: "2026-08-20" },
        { status: "withdrawn", valid_until: "2026-08-01" },
      ],
      tasks: { open: 4, overdue: 1 },
      openAudits: 2,
      openNonConformities: 3,
      config: { lowMax: 3, moderateMax: 5, highMax: 10, appetite: null },
      localDate: "2026-08-06",
    });
    expect(report.riskBands).toEqual({ low: 0, moderate: 0, high: 1, very_high: 0 });
    expect(report.evidence).toEqual({ total: 2, expired: 1, expiring: 1 });
  });
});

describe("MCP attention aggregation", () => {
  const empty: AttentionSourceRows = { tasks: [], evidence: [], policies: [], risks: [], findings: [] };

  it("validates real local dates without timezone rollover", () => {
    expect(parseLocalDate("2026-03-29")).toBe("2026-03-29"); // London BST boundary
    expect(parseLocalDate("2026-10-25")).toBe("2026-10-25"); // London GMT boundary
    expect(() => parseLocalDate("2026-02-30")).toThrowError(McpError);
  });

  it("uses strict date boundaries, sanitises titles, and sorts deterministically", () => {
    const items = buildAttentionItems({
      ...empty,
      tasks: [
        { id: "task-today", title: "Due today", due_on: "2026-08-06", status: "open" },
        { id: "task-old", title: "Email me at a@b.com <b>now</b>", due_on: "2026-08-05", status: "open" },
      ],
      evidence: [
        { id: "e-expired", title: "Evidence", valid_until: "2026-08-05", status: "current" },
        { id: "e-today", title: "Evidence today", valid_until: "2026-08-06", status: "current" },
      ],
      policies: [{ id: "p-today", reference: "POL-1", title: "Review", review_due: "2026-08-06", status: "approved" }],
      risks: [{ id: "risk", reference: "R-1", title: "Risk", review_date: null, status: "open", residual_likelihood: 5, residual_impact: 5 }],
      findings: [{ id: "finding", summary: "Finding", severity: "major_nc", status: "open", created_at: "2026-08-01T00:00:00Z" }],
    }, { localDate: "2026-08-06", config: { lowMax: 4, moderateMax: 9, highMax: 14, appetite: null } });

    expect(items.map((item) => `${item.severity}:${item.category}:${item.id}`)).toEqual([
      "critical:unresolved_finding:finding",
      "critical:stale_evidence:e-expired",
      "critical:high_risk:risk",
      "high:overdue_task:task-old",
      "high:policy_review:p-today",
      "high:stale_evidence:e-today",
    ]);
    expect(items.find(({ id }) => id === "task-old")?.summary).toBe("Overdue task: Email me at [redacted] now[redacted]");
    expect(items.some(({ id }) => id === "task-today")).toBe(false);
  });

  it("validates filters and detects limit-plus-one truncation", () => {
    const tasks = Array.from({ length: 22 }, (_, index) => ({ id: `t-${index}`, title: `Task ${index}`, due_on: "2026-08-01", status: "open" }));
    const items = buildAttentionItems({ ...empty, tasks }, {
      localDate: "2026-08-06",
      config: { lowMax: 4, moderateMax: 9, highMax: 14, appetite: null },
      categories: ["overdue_task"], severity: "high", limit: 20,
    });
    expect(items).toHaveLength(21);
    expect(() => buildAttentionItems(empty, { localDate: "2026-08-06", config: { lowMax: 4, moderateMax: 9, highMax: 14, appetite: null }, limit: 51 }))
      .toThrowError(McpError);
  });
});
