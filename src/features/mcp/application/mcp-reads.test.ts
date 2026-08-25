import { describe, expect, it, vi } from "vitest";
import {
  getComplianceOverview,
  getLatestLeadershipReport,
  dateInLondon,
  listAttentionItems,
  listGitHubComplianceResults,
  listMonitoringFindings,
  mapDeliveryStatus,
  MCP_BUNDLE_REQUEST_TIMEOUT_MS,
  prepareDailyDigest,
} from "./mcp-reads";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const REPORT = "30000000-0000-4000-8000-000000000001";
const readiness = { soaPercent: 75, soaTotal: 4, riskBands: { low: 1, moderate: 1, high: 0, very_high: 0 }, tasksOpen: 2, tasksOverdue: 1, evidence: { total: 3, expiring: 1, expired: 0 }, openAudits: 1, openNonConformities: 0 };

type State = { table: string; select?: string; filters: Array<[string, unknown, unknown?]>; orders: Array<[string, boolean]>; range?: [number, number]; limit?: number };
type Resolver = (state: State) => { data: unknown; error: unknown; count?: number | null };
type RpcResolver = (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };

function fakeSupabase(resolvers: Record<string, Resolver>, rpcResolver?: RpcResolver) {
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
  const rpcSignals: AbortSignal[] = [];
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    const result = () => rpcResolver?.(name, args) ?? { data: null, error: { message: "unexpected RPC" } };
    return {
      abortSignal: vi.fn((signal: AbortSignal) => {
        rpcSignals.push(signal);
        return Promise.resolve().then(result);
      }),
      then: (resolve: (value: ReturnType<typeof result>) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(result).then(resolve, reject),
    };
  });
  return { client: { from, rpc }, states, rpc, rpcSignals };
}

function membership(role: "owner" | "admin" | "member" = "owner"): Resolver {
  return (state) => {
    const row = { organisation_id: ORG, role, organisation: { id: ORG, name: "Acme" } };
    if (state.filters.some(([, column]) => column === "organisation_id")) return { data: row, error: null };
    return { data: state.range && state.range[0] > 0 ? [] : [row], error: null };
  };
}

function complianceBundle(role: "owner" | "admin" | "member" = "owner", overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    workspace: { id: ORG, name: "Acme", role },
    overviewSource: role === "member" ? "published" : "live",
    overview: readiness,
    attentionItems: [],
    monitoringFindings: [],
    latestLeadershipReport: null,
    delivery: null,
    ...overrides,
  };
}

function githubResults(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    workspace: { id: ORG, name: "Acme" },
    asOf: "2026-08-25T01:42:36.000Z",
    results: [{
      id: "github_result:40000000-0000-4000-8000-000000000001",
      repositoryId: "50000000-0000-4000-8000-000000000001",
      repositoryLabel: "GitHub repository 50000000",
      checkId: "branch_protection",
      result: "fail",
      severity: "high",
      observedAt: "2026-08-25T01:00:00.000Z",
      freshUntil: "2026-08-26T01:00:00.000Z",
      materialisedAt: "2026-08-25T01:01:00.000Z",
      freshness: "current",
      mappingVersion: "github-iso-2026.08",
      mappingStatus: "active",
      ruleVersion: "2026-08-17",
      summary: "Branch protection is not enabled.",
      evidenceId: null,
      findingId: "monitoring_finding:60000000-0000-4000-8000-000000000001",
    }],
    truncated: false,
    ...overrides,
  };
}

describe("MCP public read services", () => {
  it("loads only the caller-scoped official-result RPC with exact bounded filters and fails closed on unsafe rows", async () => {
    const exact = fakeSupabase({ memberships: membership("member") }, () => ({ data: githubResults(), error: null }));
    await expect(listGitHubComplianceResults(exact.client as never, USER, {
      workspaceId: ORG, repositoryId: "50000000-0000-4000-8000-000000000001", result: "fail",
      freshness: "current", mappingStatus: "active", severity: "high", limit: 7,
    })).resolves.toMatchObject({
      schemaVersion: 1, workspace: { id: ORG, name: "Acme" },
      results: [{ id: "github_result:40000000-0000-4000-8000-000000000001", repositoryLabel: "GitHub repository 50000000" }],
    });
    expect(exact.rpc).toHaveBeenCalledWith("get_mcp_github_compliance_results_v1", {
      target_organisation_id: ORG,
      target_repository_id: "50000000-0000-4000-8000-000000000001",
      target_result: "fail", target_freshness: "current", target_mapping_status: "active",
      target_severity: "high", target_limit: 7,
    });
    expect(exact.states.map(({ table }) => table)).toEqual(["memberships"]);
    expect(exact.rpcSignals).toHaveLength(1);

    const unsafe = fakeSupabase({ memberships: membership() }, () => ({
      data: githubResults({ results: [{ ...githubResults().results[0] as object, repositoryLabel: "acme/portal?token=secret" }] }), error: null,
    }));
    await expect(listGitHubComplianceResults(unsafe.client as never, USER, {})).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(listGitHubComplianceResults(exact.client as never, USER, { result: "broken" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("uses only deterministic local repository labels and rejects unordered, impossible, duplicate, or inconsistent result pages", async () => {
    const base = githubResults();
    const row = base.results[0] as Record<string, unknown>;
    const fallback = fakeSupabase({ memberships: membership() }, () => ({ data: githubResults({ results: [{ ...row, repositoryLabel: "" }] }), error: null }));
    await expect(listGitHubComplianceResults(fallback.client as never, USER, {})).resolves.toMatchObject({ results: [{ repositoryLabel: "GitHub repository 50000000" }] });

    for (const malformed of [
      githubResults({ results: [{ ...row, repositoryLabel: "octo/private" }] }),
      githubResults({ asOf: "2026-08-25T00:30:00.000Z" }),
      githubResults({ results: [{ ...row, materialisedAt: "2026-08-25T00:30:00.000Z" }] }),
      githubResults({ results: [row, row] }),
      githubResults({ truncated: false, results: Array.from({ length: 21 }, () => row) }),
    ]) {
      const fake = fakeSupabase({ memberships: membership() }, () => ({ data: malformed, error: null }));
      await expect(listGitHubComplianceResults(fake.client as never, USER, {})).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    }
    const badInput = fakeSupabase({ memberships: membership() });
    await expect(listGitHubComplianceResults(badInput.client as never, USER, { workspaceId: ORG, limit: 3, extra: "rejected" } as never)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(badInput.states).toEqual([]);
  });

  it("accepts the hidden limit-plus-one truncation shape and requires descending IDs for equal observed times", async () => {
    const base = githubResults();
    const first = base.results[0] as Record<string, unknown>;
    const second = {
      ...first,
      id: "github_result:50000000-0000-4000-8000-000000000001",
      repositoryId: "60000000-0000-4000-8000-000000000001",
      repositoryLabel: "GitHub repository 60000000",
      checkId: "secret_scanning",
    };
    const valid = fakeSupabase({ memberships: membership() }, () => ({ data: githubResults({ results: [second, first], truncated: true }), error: null }));
    await expect(listGitHubComplianceResults(valid.client as never, USER, { limit: 2 })).resolves.toMatchObject({ truncated: true, results: [{ id: second.id }, { id: first.id }] });

    for (const data of [
      githubResults({ results: [first], truncated: true }),
      githubResults({ results: [first, second, { ...second, id: "github_result:70000000-0000-4000-8000-000000000001", repositoryId: "70000000-0000-4000-8000-000000000001", repositoryLabel: "GitHub repository 70000000", checkId: "dependabot" }], truncated: true }),
      githubResults({ results: [first, second], truncated: false }),
    ]) {
      const invalid = fakeSupabase({ memberships: membership() }, () => ({ data, error: null }));
      await expect(listGitHubComplianceResults(invalid.client as never, USER, { limit: 2 })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    }
  });
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
    expect(fake.states.map(({ table }) => table)).toEqual(["memberships", "memberships"]);
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
    expect(fake.states.filter(({ table }) => table === "audit_findings").map(({ range }) => range)).toEqual([[0, 499], [500, 999], [1000, 1499], [1206, 1705]]);
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
    expect(fake.states.map(({ table }) => table)).toEqual(["memberships", "memberships"]);
  });

  it("loads Owner live readiness through one coherent RPC and fails closed on malformed output", async () => {
    const exact = fakeSupabase({ memberships: membership("owner") }, () => ({
      data: complianceBundle("owner", { overview: { ...readiness, soaTotal: 1205, soaPercent: 100 } }), error: null,
    }));
    await expect(getComplianceOverview(exact.client as never, USER, { localDate: "2026-08-06" })).resolves.toMatchObject({ source: "live", readiness: { soaTotal: 1205, soaPercent: 100 } });
    expect(exact.rpc).toHaveBeenCalledWith("get_mcp_compliance_bundle", {
      target_organisation_id: ORG, target_local_date: "2026-08-06", attention_limit: 20, monitoring_limit: 20,
    });
    expect(exact.rpcSignals).toHaveLength(1);
    expect(typeof exact.rpcSignals[0]?.addEventListener).toBe("function");
    expect(MCP_BUNDLE_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(MCP_BUNDLE_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(8_000);
    expect(exact.states.map(({ table }) => table)).toEqual(["memberships", "memberships"]);

    const malformed = fakeSupabase({ memberships: membership("owner") }, () => ({
      data: complianceBundle("owner", { overview: { ...readiness, tasksOpen: 1, tasksOverdue: 2 } }), error: null,
    }));
    await expect(getComplianceOverview(malformed.client as never, USER, { localDate: "2026-08-06" })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("maps a rejected bundle request to a safe internal error", async () => {
    const failed = fakeSupabase({ memberships: membership("owner") }, () => {
      throw new Error("request timeout exposed internal credential");
    });
    const error = await getComplianceOverview(failed.client as never, USER, { localDate: "2026-08-06" }).catch((caught) => caught);
    expect(error).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(String(error)).not.toContain("credential");
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
    expect(query.filters).toContainEqual(["in", "status", [
      "open", "acknowledged", "in_progress", "exception_requested", "risk_accepted",
    ]]);
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

    const accepted = fakeSupabase({ memberships: membership(), monitoring_findings: serverResolver });
    await expect(listMonitoringFindings(accepted.client as never, USER, { status: "risk_accepted" }))
      .resolves.toMatchObject({ findings: [] });
    expect(accepted.states.find(({ table }) => table === "monitoring_findings")?.filters)
      .toContainEqual(["eq", "status", "risk_accepted"]);
  });

  it("prepares a deterministic fact hash and exposes Owner-only delivery state", async () => {
    const fake = fakeSupabase({ memberships: membership("owner") }, () => ({ data: complianceBundle("owner", {
      delivery: { id: "50000000-0000-4000-8000-000000000001", status: "failed", deliveredAt: null },
    }), error: null }));
    const first = await prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" });
    const second = await prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" });
    expect(first.status).toBe("delivery_failed");
    expect(first.factHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.factHash).toBe(first.factHash);
    expect(fake.rpc).toHaveBeenCalledTimes(2);
    expect(new Set(fake.states.map(({ table }) => table))).toEqual(new Set(["memberships"]));
  });

  it("loads one coherent bundle per preparation and removes unsafe text end to end", async () => {
    const fake = fakeSupabase({
      memberships: (state) => {
        const row = { organisation_id: ORG, role: "owner", organisation: { id: ORG, name: "Acme < unsafe >" } };
        if (state.filters.some(([, column]) => column === "organisation_id")) return { data: row, error: null };
        return { data: state.range && state.range[0] > 0 ? [] : [row], error: null };
      },
    }, () => ({ data: complianceBundle("owner", {
      workspace: { id: ORG, name: "Acme < unsafe >", role: "owner" },
      monitoringFindings: [{ id: "monitoring_finding:45000000-0000-4000-8000-000000000001", severity: "critical", status: "open", title: "Finding < dangling >", detectedAt: "2026-08-05T00:00:00Z", resolvedAt: null, hasRemediationTask: false }],
    }), error: null }));
    const result = await prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" });
    expect(JSON.stringify(result.facts)).not.toMatch(/[<>]/);
    expect(result.facts.monitoringFindings[0]?.id).toBe("monitoring_finding:45000000-0000-4000-8000-000000000001");
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });

  it("accepts the RPC's Owner-scoped delivery omission for Admins", async () => {
    const fake = fakeSupabase({ memberships: membership("admin") }, () => ({ data: complianceBundle("admin"), error: null }));
    await expect(prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" })).resolves.toMatchObject({ status: "ready" });
    expect(fake.states.map(({ table }) => table)).toEqual(["memberships", "memberships"]);
  });

  it("rejects duplicate or inconsistent RPC facts before hashing", async () => {
    const duplicate = fakeSupabase({ memberships: membership("owner") }, () => ({ data: complianceBundle("owner", {
      attentionItems: [
        { id: "task:a", source: "task", category: "overdue_task", severity: "high", summary: "A" },
        { id: "task:a", source: "task", category: "overdue_task", severity: "high", summary: "B" },
      ],
    }), error: null }));
    await expect(prepareDailyDigest(duplicate.client as never, USER, { localDate: "2026-08-06" })).rejects.toThrow(/duplicate attention/i);

    const inconsistent = fakeSupabase({ memberships: membership("owner") }, () => ({ data: complianceBundle("owner", {
      overview: { ...readiness, evidence: { total: 1, expiring: 1, expired: 1 } },
    }), error: null }));
    await expect(prepareDailyDigest(inconsistent.client as never, USER, { localDate: "2026-08-06" })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("maps every persisted delivery state to a stable preparation state", () => {
    expect(mapDeliveryStatus(null)).toBe("ready");
    expect(mapDeliveryStatus("delivered")).toBe("already_delivered");
    expect(mapDeliveryStatus("failed")).toBe("delivery_failed");
    expect(mapDeliveryStatus("unknown")).toBe("delivery_unknown");
    expect(mapDeliveryStatus("reserved")).toBe("delivery_reserved");
  });

  it("uses the reviewed bundle RPC instead of stitching digest tables in the application", async () => {
    const fake = fakeSupabase({ memberships: membership("owner") }, () => ({ data: complianceBundle("owner"), error: null }));
    await prepareDailyDigest(fake.client as never, USER, { localDate: "2026-08-06" });
    expect(fake.states.map(({ table }) => table)).toEqual(["memberships", "memberships"]);
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });
});
