import { describe, expect, it, vi } from "vitest";
import {
  getComplianceOverview,
  getLatestLeadershipReport,
  dateInLondon,
  listAttentionItems,
  listMonitoringFindings,
  mapDeliveryStatus,
  prepareDailyDigest,
} from "./mcp-reads";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const REPORT = "30000000-0000-4000-8000-000000000001";
const readiness = { soaPercent: 75, soaTotal: 4, riskBands: { low: 1, moderate: 1, high: 0, very_high: 0 }, tasksOpen: 2, tasksOverdue: 1, evidence: { total: 3, expiring: 1, expired: 0 }, openAudits: 1, openNonConformities: 0 };

type State = { table: string; select?: string; filters: Array<[string, unknown, unknown?]>; orders: Array<[string, boolean]>; range?: [number, number]; limit?: number };
type Resolver = (state: State) => { data: unknown; error: unknown; count?: number | null };

function fakeSupabase(resolvers: Record<string, Resolver>) {
  const states: State[] = [];
  const from = vi.fn((table: string) => {
    const state: State = { table, filters: [], orders: [] };
    states.push(state);
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn((columns: string) => { state.select = columns; return chain; });
    for (const method of ["eq", "neq", "in", "lt", "lte", "not"]) {
      chain[method] = vi.fn((column: string, value: unknown, extra?: unknown) => { state.filters.push([method, column, extra ?? value]); return chain; });
    }
    chain.order = vi.fn((column: string, options?: { ascending?: boolean }) => { state.orders.push([column, options?.ascending ?? true]); return chain; });
    chain.limit = vi.fn((value: number) => { state.limit = value; return chain; });
    chain.range = vi.fn((from: number, to: number) => { state.range = [from, to]; return chain; });
    const result = () => resolvers[table]?.(state) ?? { data: [], error: null, count: 0 };
    chain.maybeSingle = vi.fn(async () => result());
    chain.then = (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  });
  return { client: { from }, states };
}

function membership(role: "owner" | "admin" | "member" = "owner"): Resolver {
  return (state) => {
    const row = { organisation_id: ORG, role, organisation: { id: ORG, name: "Acme" } };
    return { data: state.filters.some(([, column]) => column === "organisation_id") ? row : [row], error: null };
  };
}

describe("MCP public read services", () => {
  it("derives London dates correctly across midnight and DST seasons", () => {
    expect(dateInLondon(new Date("2026-01-15T00:30:00Z"))).toBe("2026-01-15");
    expect(dateInLondon(new Date("2026-07-15T23:30:00Z"))).toBe("2026-07-16");
    expect(dateInLondon(new Date("2026-03-29T00:59:59Z"))).toBe("2026-03-29");
    expect(dateInLondon(new Date("2026-03-29T23:30:00Z"))).toBe("2026-03-30");
    expect(dateInLondon(new Date("2026-10-25T00:59:59Z"))).toBe("2026-10-25");
    expect(dateInLondon(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-25");
  });

  it("gates Member overview to the latest validated published snapshot", async () => {
    const fake = fakeSupabase({
      memberships: membership("member"),
      leadership_report_snapshots: () => ({ data: { id: REPORT, payload: readiness, published_at: "2026-08-05T09:00:00Z" }, error: null }),
      risks: () => { throw new Error("Member must not read live readiness"); },
    });
    await expect(getComplianceOverview(fake.client as never, USER, { localDate: "2026-08-06" })).resolves.toMatchObject({
      workspace: { id: ORG, name: "Acme" }, source: "published", readiness,
    });
    expect(fake.states.find(({ table }) => table === "leadership_report_snapshots")?.select).toBe("id,payload,published_at");
  });

  it("returns null for an absent report and never selects publisher or organisation details", async () => {
    const fake = fakeSupabase({ memberships: membership(), leadership_report_snapshots: () => ({ data: null, error: null }) });
    await expect(getLatestLeadershipReport(fake.client as never, USER, {})).resolves.toEqual({ workspace: { id: ORG, name: "Acme" }, report: null });
    expect(fake.states.find(({ table }) => table === "leadership_report_snapshots")?.select).toBe("id,payload,published_at");
  });

  it("rejects invalid attention filters before reading compliance tables", async () => {
    const fake = fakeSupabase({ memberships: membership() });
    await expect(listAttentionItems(fake.client as never, USER, { limit: 51 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fake.states.map(({ table }) => table)).toEqual(["memberships"]);
  });

  it("queries all attention pages before deriving severity and applying the final limit", async () => {
    const findings = Array.from({ length: 1_205 }, (_, index) => ({
      id: `41000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      severity: "observation", status: "open", created_at: "2026-07-01T00:00:00Z", audit: { reference: "AUD-OLD" },
    })).concat([{
      id: "42000000-0000-4000-8000-000000000001", severity: "major_nc", status: "open", created_at: "2026-08-05T00:00:00Z", audit: { reference: "AUD-CRITICAL" },
    }]);
    const fake = fakeSupabase({ memberships: membership(), audit_findings: (state) => ({ data: state.range ? findings.slice(state.range[0], state.range[1] + 1) : findings, error: null }) });
    const result = await listAttentionItems(fake.client as never, USER, { categories: ["unresolved_finding"], severity: "critical", limit: 1, localDate: "2026-08-06" });
    expect(result.items).toEqual([expect.objectContaining({ id: "audit_finding:42000000-0000-4000-8000-000000000001", severity: "critical" })]);
    expect(new Set(fake.states.map(({ table }) => table))).toEqual(new Set(["memberships", "audit_findings"]));
    expect(fake.states.find(({ table }) => table === "audit_findings")?.select).toBe("id,severity,status,created_at,audit:audits!inner(reference)");
    expect(fake.states.filter(({ table }) => table === "audit_findings").map(({ range }) => range)).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(fake.states.filter(({ table }) => table === "audit_findings").every(({ limit }) => limit === undefined)).toBe(true);
  });

  it("fails closed when a later attention page fails", async () => {
    const findings = Array.from({ length: 500 }, (_, index) => ({
      id: `46000000-0000-4000-8000-${String(index).padStart(12, "0")}`, severity: "observation", status: "open", created_at: "2026-07-01T00:00:00Z", audit: { reference: "AUD" },
    }));
    const fake = fakeSupabase({
      memberships: membership(),
      audit_findings: (state) => state.range![0] >= 500 ? { data: null, error: { message: "page unavailable" } } : { data: findings, error: null },
    });
    await expect(listAttentionItems(fake.client as never, USER, { categories: ["unresolved_finding"], localDate: "2026-08-06" }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(fake.states.filter(({ table }) => table === "audit_findings").map(({ range }) => range)).toEqual([[0, 499], [500, 999]]);
  });

  it("queries no compliance tables for an empty attention category list", async () => {
    const fake = fakeSupabase({ memberships: membership() });
    await expect(listAttentionItems(fake.client as never, USER, { categories: [], localDate: "2026-08-06" })).resolves.toMatchObject({ items: [], truncated: false });
    expect(fake.states.map(({ table }) => table)).toEqual(["memberships"]);
  });

  it("loads every live readiness page and fails closed if a later page fails", async () => {
    const soaRows = Array.from({ length: 1_205 }, (_, index) => ({ id: `43000000-0000-4000-8000-${String(index).padStart(12, "0")}`, status: "advanced" }));
    const base: Record<string, Resolver> = {
      memberships: membership("owner"), leadership_report_snapshots: () => ({ data: null, error: null }), soa_registers: () => ({ data: { id: "44000000-0000-4000-8000-000000000001" }, error: null }),
      soa_items: (state) => ({ data: soaRows.slice(state.range![0], state.range![1] + 1), error: null }), risks: () => ({ data: [], error: null }), evidence: () => ({ data: [], error: null }),
      tasks: () => ({ data: [], error: null, count: 0 }), audits: () => ({ data: [], error: null, count: 0 }), audit_findings: () => ({ data: [], error: null, count: 0 }), risk_matrix_config: () => ({ data: null, error: null }),
    };
    const exact = fakeSupabase(base);
    await expect(getComplianceOverview(exact.client as never, USER, { localDate: "2026-08-06" })).resolves.toMatchObject({ readiness: { soaTotal: 1205, soaPercent: 100 } });
    expect(exact.states.filter(({ table }) => table === "soa_items").map(({ range }) => range)).toEqual([[0, 499], [500, 999], [1000, 1499]]);

    const failed = fakeSupabase({ ...base, soa_items: (state) => state.range![0] >= 500 ? { data: null, error: { message: "later page" } } : { data: soaRows.slice(0, 500), error: null } });
    await expect(getComplianceOverview(failed.client as never, USER, { localDate: "2026-08-06" })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("selects only safe monitoring columns, hides task IDs, sanitises titles, and applies active defaults", async () => {
    const fake = fakeSupabase({
      memberships: membership(),
      monitoring_findings: () => ({ data: [{ id: "40000000-0000-4000-8000-000000000001", control_ref: "A.8.1", severity: "high", title: "Leak token=abc <x>", status: "open", task_id: "private-task", detected_at: "2026-08-01T00:00:00Z", resolved_at: null }], error: null }),
    });
    const result = await listMonitoringFindings(fake.client as never, USER, {});
    expect(result.findings[0]).toMatchObject({ title: "Leak [redacted]", hasRemediationTask: true });
    expect(result.findings[0]).not.toHaveProperty("taskId");
    const query = fake.states.find(({ table }) => table === "monitoring_findings")!;
    expect(query.select).toBe("id,control_ref,severity,title,status,task_id,detected_at,resolved_at");
    expect(query.filters).toContainEqual(["in", "status", ["open", "acknowledged"]]);
  });

  it("sorts shuffled monitoring rows deterministically and fails closed on query errors", async () => {
    const row = (id: string, severity: "low" | "critical", detected: string) => ({ id, control_ref: "", severity, title: id, status: "open", task_id: null, detected_at: detected, resolved_at: null });
    const fake = fakeSupabase({
      memberships: membership(),
      monitoring_findings: () => ({ data: [
        row("40000000-0000-4000-8000-000000000003", "low", "2026-08-03T00:00:00Z"),
        row("40000000-0000-4000-8000-000000000002", "critical", "2026-08-01T00:00:00Z"),
        row("40000000-0000-4000-8000-000000000001", "critical", "2026-08-01T00:00:00Z"),
      ], error: null }),
    });
    await expect(listMonitoringFindings(fake.client as never, USER, {})).resolves.toMatchObject({ findings: [
      { id: "monitoring_finding:40000000-0000-4000-8000-000000000001" },
      { id: "monitoring_finding:40000000-0000-4000-8000-000000000002" },
      { id: "monitoring_finding:40000000-0000-4000-8000-000000000003" },
    ] });

    const failed = fakeSupabase({ memberships: membership(), monitoring_findings: () => ({ data: null, error: { message: "database secret" } }) });
    await expect(listMonitoringFindings(failed.client as never, USER, {})).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("models Postgres enum ordering and server-side monitoring filters with limit-plus-one", async () => {
    const rows = [
      { id: "47000000-0000-4000-8000-000000000001", control_ref: "", severity: "medium", title: "Medium", status: "open", task_id: null, detected_at: "2026-08-06T12:00:00Z", resolved_at: null },
      { id: "47000000-0000-4000-8000-000000000002", control_ref: "", severity: "critical", title: "Critical older", status: "open", task_id: null, detected_at: "2026-08-05T12:00:00Z", resolved_at: null },
      { id: "47000000-0000-4000-8000-000000000003", control_ref: "", severity: "high", title: "High", status: "open", task_id: null, detected_at: "2026-08-06T13:00:00Z", resolved_at: null },
      { id: "47000000-0000-4000-8000-000000000004", control_ref: "", severity: "critical", title: "Critical newer", status: "open", task_id: null, detected_at: "2026-08-06T10:00:00Z", resolved_at: null },
      { id: "47000000-0000-4000-8000-000000000005", control_ref: "", severity: "high", title: "Acknowledged high", status: "acknowledged", task_id: null, detected_at: "2026-08-06T14:00:00Z", resolved_at: null },
    ];
    const enumRank: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    const serverResolver: Resolver = (state) => {
      let output = rows.filter((row) => state.filters.every(([method, column, value]) => {
        if (column === "organisation_id") return value === ORG;
        if (method === "eq") return row[column as keyof typeof row] === value;
        if (method === "in") return (value as unknown[]).includes(row[column as keyof typeof row]);
        return true;
      }));
      output = output.sort((left, right) => {
        for (const [column, ascending] of state.orders) {
          const a = column === "severity" ? enumRank[left.severity] : String(left[column as keyof typeof left]);
          const b = column === "severity" ? enumRank[right.severity] : String(right[column as keyof typeof right]);
          const comparison = a < b ? -1 : a > b ? 1 : 0;
          if (comparison) return ascending ? comparison : -comparison;
        }
        return 0;
      });
      return { data: output.slice(0, state.limit), error: null };
    };
    const top = fakeSupabase({ memberships: membership(), monitoring_findings: serverResolver });
    await expect(listMonitoringFindings(top.client as never, USER, { limit: 2 })).resolves.toMatchObject({
      findings: [{ title: "Critical newer" }, { title: "Critical older" }], truncated: true,
    });
    const topQuery = top.states.find(({ table }) => table === "monitoring_findings")!;
    expect(topQuery.orders).toEqual([["severity", false], ["detected_at", false], ["id", true]]);
    expect(topQuery.limit).toBe(3);

    const filtered = fakeSupabase({ memberships: membership(), monitoring_findings: serverResolver });
    await expect(listMonitoringFindings(filtered.client as never, USER, { status: "acknowledged", severity: "high", limit: 1 })).resolves.toMatchObject({
      findings: [{ title: "Acknowledged high" }], truncated: false,
    });
    const filteredQuery = filtered.states.find(({ table }) => table === "monitoring_findings")!;
    expect(filteredQuery.filters).toEqual(expect.arrayContaining([["eq", "status", "acknowledged"], ["eq", "severity", "high"]]));
    expect(filteredQuery.limit).toBe(2);
  });

  it("prepares a deterministic fact hash and exposes Owner-only delivery state", async () => {
    const rows: Record<string, unknown> = {
      soa_registers: null, risks: [], evidence: [], audits: [], audit_findings: [], tasks: [], policies: [], monitoring_findings: [], risk_matrix_config: null,
      leadership_report_snapshots: null,
      daily_digest_deliveries: { id: "50000000-0000-4000-8000-000000000001", status: "failed", delivered_at: null },
    };
    const fake = fakeSupabase({
      memberships: membership("owner"),
      ...Object.fromEntries(Object.entries(rows).map(([table, data]) => [table, () => ({ data, error: null, count: 0 })])),
    });
    const first = await prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" });
    const second = await prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" });
    expect(first.status).toBe("delivery_failed");
    expect(first.factHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.factHash).toBe(first.factHash);
    expect(fake.states.find(({ table }) => table === "daily_digest_deliveries")?.select).toBe("id,status,delivered_at");
    expect(fake.states.filter(({ table }) => table === "leadership_report_snapshots")).toHaveLength(2);
  });

  it("loads one snapshot per preparation and removes angle brackets end to end", async () => {
    const fake = fakeSupabase({
      memberships: (state) => {
        const row = { organisation_id: ORG, role: "owner", organisation: { id: ORG, name: "Acme < unsafe >" } };
        return { data: state.filters.some(([, column]) => column === "organisation_id") ? row : [row], error: null };
      },
      leadership_report_snapshots: () => ({ data: null, error: null }), soa_registers: () => ({ data: null, error: null }), risks: () => ({ data: [], error: null }), evidence: () => ({ data: [], error: null }),
      audits: () => ({ data: [], error: null, count: 0 }), audit_findings: () => ({ data: [], error: null, count: 0 }), tasks: () => ({ data: [], error: null, count: 0 }), policies: () => ({ data: [], error: null }),
      monitoring_findings: () => ({ data: [{ id: "45000000-0000-4000-8000-000000000001", control_ref: "", severity: "critical", title: "Finding < dangling >", status: "open", task_id: null, detected_at: "2026-08-05T00:00:00Z", resolved_at: null }], error: null }),
      risk_matrix_config: () => ({ data: null, error: null }), daily_digest_deliveries: () => ({ data: null, error: null }),
    });
    const result = await prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" });
    expect(JSON.stringify(result.facts)).not.toMatch(/[<>]/);
    expect(result.facts.monitoringFindings[0]?.id).toBe("monitoring_finding:45000000-0000-4000-8000-000000000001");
    expect(fake.states.filter(({ table }) => table === "leadership_report_snapshots")).toHaveLength(1);
  });

  it("does not query delivery history for Admins", async () => {
    const fake = fakeSupabase({
      memberships: membership("admin"),
      soa_registers: () => ({ data: null, error: null }), risks: () => ({ data: [], error: null }), evidence: () => ({ data: [], error: null }),
      audits: () => ({ data: [], error: null, count: 0 }), audit_findings: () => ({ data: [], error: null, count: 0 }), tasks: () => ({ data: [], error: null, count: 0 }),
      policies: () => ({ data: [], error: null }), monitoring_findings: () => ({ data: [], error: null }), risk_matrix_config: () => ({ data: null, error: null }), leadership_report_snapshots: () => ({ data: null, error: null }),
      daily_digest_deliveries: () => { throw new Error("Admin must not query Owner delivery history"); },
    });
    await expect(prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" })).resolves.toMatchObject({ status: "ready" });
    expect(fake.states.some(({ table }) => table === "daily_digest_deliveries")).toBe(false);
  });

  it("maps every persisted delivery state to a stable preparation state", () => {
    expect(mapDeliveryStatus(null)).toBe("ready");
    expect(mapDeliveryStatus("delivered")).toBe("already_delivered");
    expect(mapDeliveryStatus("failed")).toBe("delivery_failed");
    expect(mapDeliveryStatus("unknown")).toBe("delivery_unknown");
    expect(mapDeliveryStatus("reserved")).toBe("delivery_reserved");
  });

  it("uses only the reviewed allow-list of Data API projections", async () => {
    const fake = fakeSupabase({
      memberships: membership("owner"), soa_registers: () => ({ data: null, error: null }), risks: () => ({ data: [], error: null }), evidence: () => ({ data: [], error: null }),
      audits: () => ({ data: [], error: null, count: 0 }), audit_findings: () => ({ data: [], error: null, count: 0 }), tasks: () => ({ data: [], error: null, count: 0 }), policies: () => ({ data: [], error: null }),
      monitoring_findings: () => ({ data: [], error: null }), risk_matrix_config: () => ({ data: null, error: null }), leadership_report_snapshots: () => ({ data: null, error: null }), daily_digest_deliveries: () => ({ data: null, error: null }),
    });
    await prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" });
    const allowed = new Set([
      "organisation_id,role,organisation:organisations!inner(id,name)",
      "id,payload,published_at", "id", "id,status", "id,status,residual_likelihood,residual_impact",
      "id,status,valid_until", "low_max,moderate_max,high_max,appetite_threshold", "id,title,due_on,status",
      "id,title,valid_until,status", "id,reference,title,review_due,status",
      "id,reference,title,review_date,status,residual_likelihood,residual_impact", "id,severity,status,created_at,audit:audits!inner(reference)",
      "id,control_ref,severity,title,status,task_id,detected_at,resolved_at", "id,status,delivered_at",
    ]);
    expect(fake.states.every(({ select }) => !select || allowed.has(select))).toBe(true);
  });
});
