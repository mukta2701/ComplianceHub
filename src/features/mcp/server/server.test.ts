import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpError } from "../auth/errors";
import { githubPublicPageHash } from "../application/github-results-cursor";
import { WorkspaceRequiredError } from "../application/workspace-access";
import { buildDailyDigestFacts } from "../domain/digest";
import { createComplianceMcpServer, MCP_SERVER_INSTRUCTIONS, type McpReadServices } from "./server";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "20000000-0000-4000-8000-000000000001";
const REPORT_ID = "30000000-0000-4000-8000-000000000001";
const RESOURCE = "https://compliance.example/mcp";
const readiness = {
  soaPercent: 75, soaTotal: 4,
  riskBands: { low: 1, moderate: 1, high: 1, very_high: 0 },
  tasksOpen: 2, tasksOverdue: 1,
  evidence: { total: 3, expiring: 1, expired: 0 },
  openAudits: 1, openNonConformities: 0,
};
const digestFacts = buildDailyDigestFacts({
  workspace: { id: WORKSPACE_ID, name: "Acme" }, localDate: "2026-08-07", overview: readiness,
  attentionItems: [], monitoringFindings: [], latestLeadershipReport: null,
  github: {
    partition: { activeCurrentPass: 1, activeCurrentFail: 0, activeCurrentUnknown: 0, activeCurrentNotApplicable: 0, activeStale: 0, historical: 0, total: 1 },
    baseline: null,
    changes: { counts: { newFailure: 0, reopen: 0, resolution: 0, supersedingPass: 0, total: 0 }, items: [], truncated: false },
    unknowns: { count: 0, items: [], truncated: false },
    staleResults: { count: 0, items: [], truncated: false },
    recommendedActions: { count: 0, items: [], truncated: false },
  },
});

const GITHUB_CURSOR = `ch4.${"a".repeat(16)}.${"b".repeat(200)}.${"c".repeat(22)}.${"d".repeat(64)}`;
const githubV2ResultCore = {
  schemaVersion: 2 as const,
  workspace: { id: WORKSPACE_ID, name: "Acme" },
  snapshotAt: "2026-08-25T01:42:36.000Z",
  results: [{
    id: `github_result:${REPORT_ID}`,
    repositoryId: REPORT_ID,
    repositoryLabel: "GitHub repository 30000000",
    collectionRunId: "github_run:40000000-0000-4000-8000-000000000001",
    runMode: "official" as const,
    checkId: "github.branch.stale_approvals",
    result: "fail" as const,
    severity: "high" as const,
    observedAt: "2026-08-25T01:00:00.000Z",
    freshUntil: "2026-08-26T01:00:00.000Z",
    materialisedAt: "2026-08-25T01:01:00.000Z",
    freshness: "current" as const,
    mappingVersion: "github-iso-27001-v1",
    mappingChecksum: "b".repeat(64),
    mappingStatus: "active" as const,
    ruleVersion: "github-repository-v1",
    sourceResponseFingerprint: "c".repeat(64),
    summary: "A failed GitHub branch-control observation creates or refreshes a finding.",
    evidenceId: null,
    findingId: `monitoring_finding:${REPORT_ID}`,
    recordHash: "d".repeat(64),
  }],
  nextCursor: null as string | null,
  truncated: false,
  pageKind: "initial" as "initial" | "continuation",
};

type GitHubV2ResultCore = typeof githubV2ResultCore;

function githubPage(overrides: Partial<GitHubV2ResultCore> = {}, pageHash?: string) {
  const page = { ...githubV2ResultCore, ...overrides };
  return { ...page, pageHash: pageHash ?? githubPublicPageHash(page) };
}

const githubV2Result = githubPage();

const servers: Array<{ close(): Promise<void> }> = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

function serviceStubs(): McpReadServices {
  return {
    listWorkspaces: vi.fn(async () => [{ id: WORKSPACE_ID, name: "Acme", role: "owner" as const }]),
    getComplianceOverview: vi.fn(async () => ({
      workspace: { id: WORKSPACE_ID, name: "Acme" }, source: "live" as const,
      readiness, latestReport: { id: REPORT_ID, publishedAt: "2026-08-06T09:00:00.000Z" },
    })),
    listAttentionItems: vi.fn(async () => ({
      workspace: { id: WORKSPACE_ID, name: "Acme" }, truncated: false,
      items: [{ id: `task:${REPORT_ID}`, source: "task" as const, category: "overdue_task" as const, severity: "high" as const, summary: "Overdue task", dueOn: "2026-08-05" }],
    })),
    listGitHubComplianceResults: vi.fn(async (_supabase, _userId, input) => githubPage({
      pageKind: input.cursor ? "continuation" : "initial",
    })) as never,
    listMonitoringFindings: vi.fn(async () => ({
      workspace: { id: WORKSPACE_ID, name: "Acme" }, truncated: false,
      findings: [{ id: `monitoring_finding:${REPORT_ID}`, severity: "critical" as const, status: "open" as const, title: "Branch protection disabled", controlRef: "A.8.1", detectedAt: "2026-08-06T10:00:00.000Z", resolvedAt: null, hasRemediationTask: false }],
    })),
    getLatestLeadershipReport: vi.fn(async () => ({
      workspace: { id: WORKSPACE_ID, name: "Acme" },
      report: { id: REPORT_ID, payload: readiness, publishedAt: "2026-08-06T09:00:00.000Z" },
    })),
    prepareDailyDigest: vi.fn(async () => ({
      status: "ready" as const,
      facts: digestFacts,
      factHash: "a".repeat(64), delivery: null,
    })),
    postDailyDigest: vi.fn(async () => ({
      workspace: { id: WORKSPACE_ID, name: "Acme" }, localDate: "2026-08-07",
      status: "delivered" as const, delivery: { id: REPORT_ID, attemptNumber: 1 },
    })),
  };
}

async function connected(services = serviceStubs()) {
  const server = createComplianceMcpServer({ userId: USER_ID, clientId: "codex-test", supabase: {} as never, resource: RESOURCE }, services);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  servers.push(server);
  clients.push(client);
  return { client, services };
}

async function expectGitHubPageRejected(
  page: ReturnType<typeof githubPage>,
  input: Record<string, unknown> = {},
) {
  const services = serviceStubs();
  vi.mocked(services.listGitHubComplianceResults).mockResolvedValueOnce(page as never);
  const { client } = await connected(services);
  const response = await client.callTool({ name: "list_github_compliance_results", arguments: input });
  expect(response).toMatchObject({ isError: true, structuredContent: { error: { code: "INTERNAL_ERROR" } } });
}

describe("ComplianceHub MCP server", () => {
  it("initializes with stable identity, safety-first instructions, and exactly eight tools", async () => {
    const { client } = await connected();
    expect(client.getServerVersion()).toEqual({ name: "compliancehub-internal", version: "0.3.0" });
    expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(MCP_SERVER_INSTRUCTIONS.slice(0, 512)).toMatch(/Supabase is canonical[\s\S]*closed-world[\s\S]*Never invent/);

    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      "list_workspaces", "get_compliance_overview", "list_attention_items",
      "list_monitoring_findings", "list_github_compliance_results", "get_latest_leadership_report", "prepare_daily_digest",
      "post_daily_digest",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject(tool.name === "post_daily_digest"
        ? { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
        : { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true });
      expect(tool._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["openid", "email", "profile"] }]);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      if (tool.name !== "list_workspaces") expect(tool.inputSchema).toMatchObject({ additionalProperties: false });
      expect(tool.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
    expect(tools.find(({ name }) => name === "list_attention_items")?.inputSchema.properties).not.toHaveProperty("localDate");
    expect(tools.find(({ name }) => name === "get_compliance_overview")?.inputSchema.properties).not.toHaveProperty("localDate");
    expect(tools.find(({ name }) => name === "prepare_daily_digest")?.inputSchema.required).toContain("localDate");
    const post = tools.find(({ name }) => name === "post_daily_digest");
    expect(post?.description).toMatch(/external Slack write[\s\S]*authorization to send[\s\S]*configured channel[\s\S]*prepare/i);
    expect(post?.inputSchema.required).toEqual(expect.arrayContaining(["localDate", "factHash", "headline", "priorities", "actions"]));
    const github = tools.find(({ name }) => name === "list_github_compliance_results");
    expect(github?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(github?.description).toMatch(/starts without a cursor[\s\S]*same workspace[\s\S]*(?:normalized )?filters[\s\S]*limit[\s\S]*nextCursor[\s\S]*until null[\s\S]*pageKind=continuation[\s\S]*never exhaustive/i);
    expect(github?.inputSchema).toMatchObject({ additionalProperties: false, properties: expect.objectContaining({ repositoryId: expect.any(Object), result: expect.any(Object), freshness: expect.any(Object), mappingStatus: expect.any(Object), severity: expect.any(Object), limit: expect.any(Object), cursor: expect.any(Object) }) });
    expect(JSON.stringify(github?.outputSchema)).toContain('"const":2');
    expect(JSON.stringify(github?.outputSchema)).toMatch(/collectionRunId[\s\S]*runMode[\s\S]*mappingChecksum[\s\S]*sourceResponseFingerprint[\s\S]*recordHash[\s\S]*nextCursor[\s\S]*pageKind[\s\S]*pageHash/);
    const prepare = tools.find(({ name }) => name === "prepare_daily_digest");
    expect(prepare?.description).toMatch(/schema-v2[\s\S]*verified[\s\S]*unknown[\s\S]*stale[\s\S]*historical/i);
    expect(JSON.stringify(prepare?.outputSchema)).toContain('"const":2');
    expect(tools.filter(({ annotations }) => annotations?.openWorldHint)).toHaveLength(1);
  });

  it("calls all eight tools with authenticated user and OAuth-client context and returns stable structured content", async () => {
    const { client, services } = await connected();
    const calls = [
      ["list_workspaces", {}],
      ["get_compliance_overview", { workspaceId: WORKSPACE_ID }],
      ["list_attention_items", { workspaceId: WORKSPACE_ID, categories: ["overdue_task"], severity: "high", limit: 5 }],
      ["list_monitoring_findings", { workspaceId: WORKSPACE_ID, status: "open", severity: "critical", limit: 5 }],
      ["list_monitoring_findings", { workspaceId: WORKSPACE_ID, status: "risk_accepted", limit: 5 }],
      ["list_github_compliance_results", { workspaceId: WORKSPACE_ID, result: "fail", freshness: "current", limit: 5 }],
      ["get_latest_leadership_report", { workspaceId: WORKSPACE_ID }],
      ["prepare_daily_digest", { workspaceId: WORKSPACE_ID, localDate: "2026-08-07" }],
      ["post_daily_digest", { workspaceId: WORKSPACE_ID, localDate: "2026-08-07", factHash: "a".repeat(64), headline: "Compliance needs attention", priorities: [], actions: [] }],
    ] as const;
    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ ok: true });
      expect(result.content).toEqual([expect.objectContaining({ type: "text", text: expect.any(String) })]);
    }
    expect(services.listWorkspaces).toHaveBeenCalledWith(expect.anything(), USER_ID);
    expect(services.getComplianceOverview).toHaveBeenCalledWith(expect.anything(), USER_ID, { workspaceId: WORKSPACE_ID });
    expect(services.listAttentionItems).toHaveBeenCalledWith(expect.anything(), USER_ID, { workspaceId: WORKSPACE_ID, categories: ["overdue_task"], severity: "high", limit: 5 });
    expect(services.listGitHubComplianceResults).toHaveBeenCalledWith(
      expect.anything(), USER_ID,
      { workspaceId: WORKSPACE_ID, result: "fail", freshness: "current", limit: 5 },
      { clientId: "codex-test", resource: RESOURCE },
    );
    expect(services.prepareDailyDigest).toHaveBeenCalledWith(expect.anything(), USER_ID, { workspaceId: WORKSPACE_ID, localDate: "2026-08-07" });
    expect(services.postDailyDigest).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, clientId: "codex-test" }));
  });

  it("maps strict-schema failures, workspace choices, and unknown exceptions to safe structured errors", async () => {
    const services = serviceStubs();
    vi.mocked(services.getComplianceOverview).mockRejectedValueOnce(new McpError("FORBIDDEN"));
    vi.mocked(services.listAttentionItems).mockRejectedValueOnce(new WorkspaceRequiredError([{ id: WORKSPACE_ID, name: "Acme", role: "owner" }]));
    vi.mocked(services.listMonitoringFindings).mockRejectedValueOnce(new Error("database password is secret"));
    const { client } = await connected(services);

    const invalid = await client.callTool({ name: "prepare_daily_digest", arguments: { localDate: "2026-02-30", extra: true } });
    expect(invalid).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "VALIDATION_ERROR" } } });
    const invalidPostDate = await client.callTool({
      name: "post_daily_digest",
      arguments: {
        localDate: "2026-02-31",
        factHash: "a".repeat(64),
        headline: "75% readiness",
        priorities: [],
        actions: [],
      },
    });
    expect(invalidPostDate).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "VALIDATION_ERROR" } } });
    expect(services.postDailyDigest).not.toHaveBeenCalled();
    const invalidEmpty = await client.callTool({ name: "list_workspaces", arguments: { extra: true } });
    expect(invalidEmpty).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "VALIDATION_ERROR" } } });
    const forbidden = await client.callTool({ name: "get_compliance_overview", arguments: {} });
    expect(forbidden).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "FORBIDDEN" } } });
    const choices = await client.callTool({ name: "list_attention_items", arguments: {} });
    expect(choices).toMatchObject({ isError: true, structuredContent: { error: { code: "WORKSPACE_REQUIRED", choices: [{ id: WORKSPACE_ID, name: "Acme" }] } } });
    const unknown = await client.callTool({ name: "list_monitoring_findings", arguments: {} });
    expect(unknown).toMatchObject({ isError: true, structuredContent: { error: { code: "INTERNAL_ERROR" } } });
    expect(JSON.stringify(unknown)).not.toContain("database password");
    for (const result of [invalid, invalidPostDate, invalidEmpty, forbidden, choices, unknown]) expect(result).not.toHaveProperty("_meta.mcp/www_authenticate");
  });

  it("fails closed when a service violates its declared output contract", async () => {
    const services = serviceStubs();
    vi.mocked(services.getLatestLeadershipReport).mockResolvedValueOnce({
      workspace: { id: WORKSPACE_ID, name: "Acme" },
      report: { id: "not-a-stable-id", payload: readiness, publishedAt: "2026-08-06T09:00:00.000Z" },
    });
    const { client } = await connected(services);
    const result = await client.callTool({ name: "get_latest_leadership_report", arguments: {} });
    expect(result).toMatchObject({ isError: true, structuredContent: { error: { code: "INTERNAL_ERROR" } } });
    expect(JSON.stringify(result)).not.toContain("not-a-stable-id");
  });

  it("accepts a 120-character rule version and rejects malformed provenance UUIDs on the GitHub result read", async () => {
    const services = serviceStubs();
    const { client } = await connected(services);
    vi.mocked(services.listGitHubComplianceResults).mockResolvedValueOnce(githubPage({
      results: [{ ...githubV2Result.results[0], ruleVersion: "r".repeat(120) }],
    }) as never);
    const boundaryResponse = await client.callTool({ name: "list_github_compliance_results", arguments: {} });
    expect(boundaryResponse.isError).not.toBe(true);

    const malformedUuid = "-".repeat(36);
    for (const result of [
      { ...githubV2Result.results[0], id: `github_result:${malformedUuid}` },
      { ...githubV2Result.results[0], collectionRunId: `github_run:${malformedUuid}` },
      { ...githubV2Result.results[0], result: "pass", severity: null, evidenceId: `evidence:${malformedUuid}`, findingId: null },
      { ...githubV2Result.results[0], findingId: `monitoring_finding:${malformedUuid}` },
      { ...githubV2Result.results[0], ruleVersion: "r".repeat(121) },
    ]) {
      vi.mocked(services.listGitHubComplianceResults).mockResolvedValueOnce(githubPage({ results: [result] as never }) as never);
      const response = await client.callTool({ name: "list_github_compliance_results", arguments: {} });
      expect(response).toMatchObject({ isError: true, structuredContent: { error: { code: "INTERNAL_ERROR" } } });
      expect(JSON.stringify(response)).not.toContain(malformedUuid);
    }
  });

  it("returns schema-v2 official provenance and an opaque continuation cursor through the unchanged read-only tool name", async () => {
    const services = serviceStubs();
    const continuedPage = githubPage({
      nextCursor: GITHUB_CURSOR,
      truncated: true,
      pageKind: "continuation",
    });
    vi.mocked(services.listGitHubComplianceResults).mockResolvedValueOnce(continuedPage as never);
    const { client } = await connected(services);

    const result = await client.callTool({
      name: "list_github_compliance_results",
      arguments: { workspaceId: WORKSPACE_ID, result: "fail", limit: 1, cursor: GITHUB_CURSOR },
    });

    expect(result.isError).not.toBe(true);
    expect(result).toMatchObject({ structuredContent: { ok: true, data: continuedPage } });
    expect(services.listGitHubComplianceResults).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      { workspaceId: WORKSPACE_ID, result: "fail", limit: 1, cursor: GITHUB_CURSOR },
      { clientId: "codex-test", resource: RESOURCE },
    );
  });

  it("fails closed when a passing GitHub result lacks evidence or claims a finding or severity", async () => {
    const base = githubV2Result.results[0];
    for (const contradiction of [
      { evidenceId: null, findingId: null, severity: null },
      { evidenceId: `evidence:${REPORT_ID}`, findingId: `monitoring_finding:${REPORT_ID}`, severity: null },
      { evidenceId: `evidence:${REPORT_ID}`, findingId: null, severity: "high" },
    ]) {
      await expectGitHubPageRejected(githubPage({
        results: [{ ...base, result: "pass", ...contradiction }] as never,
      }));
    }
  });

  it("fails closed when a failing GitHub result lacks a finding or severity or claims pass evidence", async () => {
    const base = githubV2Result.results[0];
    for (const contradiction of [
      { severity: null, evidenceId: null, findingId: `monitoring_finding:${REPORT_ID}` },
      { severity: "high", evidenceId: null, findingId: null },
      { severity: "high", evidenceId: `evidence:${REPORT_ID}`, findingId: `monitoring_finding:${REPORT_ID}` },
    ]) {
      await expectGitHubPageRejected(githubPage({ results: [{ ...base, ...contradiction }] as never }));
    }
  });

  it("fails closed when unknown or not-applicable GitHub results claim severity or lifecycle records", async () => {
    const base = githubV2Result.results[0];
    for (const result of ["unknown", "not_applicable"] as const) {
      for (const contradiction of [
        { severity: "high", evidenceId: null, findingId: null },
        { severity: null, evidenceId: `evidence:${REPORT_ID}`, findingId: null },
        { severity: null, evidenceId: null, findingId: `monitoring_finding:${REPORT_ID}` },
      ]) {
        await expectGitHubPageRejected(githubPage({
          results: [{ ...base, result, ...contradiction }] as never,
        }));
      }
    }
  });

  it("accepts only the coherent lifecycle shape for each GitHub outcome", async () => {
    const base = githubV2Result.results[0];
    const validOutcomes = [
      { result: "pass", severity: null, evidenceId: `evidence:${REPORT_ID}`, findingId: null },
      { result: "fail", severity: "high", evidenceId: null, findingId: `monitoring_finding:${REPORT_ID}` },
      { result: "unknown", severity: null, evidenceId: null, findingId: null },
      { result: "not_applicable", severity: null, evidenceId: null, findingId: null },
    ];
    const services = serviceStubs();
    for (const outcome of validOutcomes) {
      vi.mocked(services.listGitHubComplianceResults).mockResolvedValueOnce(githubPage({
        results: [{ ...base, ...outcome }] as never,
      }) as never);
    }
    const { client } = await connected(services);

    for (const outcome of validOutcomes) {
      const response = await client.callTool({ name: "list_github_compliance_results", arguments: {} });
      expect(response).toMatchObject({
        structuredContent: { ok: true, data: { results: [expect.objectContaining({ result: outcome.result })] } },
      });
    }
  });

  it("fails closed on impossible result chronology or freshness relative to the snapshot", async () => {
    const base = githubV2Result.results[0];
    for (const contradiction of [
      { freshUntil: base.observedAt },
      { materialisedAt: "2026-08-25T00:59:59.000Z" },
      { materialisedAt: "2026-08-25T01:42:37.000Z" },
      { freshUntil: "2026-08-25T01:42:36.000Z", freshness: "current" },
      { freshUntil: "2026-08-26T01:00:00.000Z", freshness: "stale" },
    ]) {
      await expectGitHubPageRejected(githubPage({ results: [{ ...base, ...contradiction }] as never }));
    }
  });

  it("fails closed instead of returning an unsafe GitHub result summary", async () => {
    const unsafeSummary = "Review https://github.com/acme/private?token=secret";
    const page = githubPage({ results: [{ ...githubV2Result.results[0], summary: unsafeSummary }] as never });
    const services = serviceStubs();
    vi.mocked(services.listGitHubComplianceResults).mockResolvedValueOnce(page as never);
    const { client } = await connected(services);

    const response = await client.callTool({ name: "list_github_compliance_results", arguments: {} });

    expect(response).toMatchObject({ isError: true, structuredContent: { error: { code: "INTERNAL_ERROR" } } });
    expect(JSON.stringify(response)).not.toContain(unsafeSummary);
  });

  it("fails closed on duplicate or non-deterministically ordered GitHub result rows", async () => {
    const base = githubV2Result.results[0];
    const lowerId = {
      ...base,
      id: "github_result:20000000-0000-4000-8000-000000000001",
      repositoryId: "50000000-0000-4000-8000-000000000001",
      repositoryLabel: "GitHub repository 50000000",
      findingId: "monitoring_finding:50000000-0000-4000-8000-000000000001",
    };
    await expectGitHubPageRejected(githubPage({ results: [base, base] as never }));
    await expectGitHubPageRejected(githubPage({ results: [lowerId, base] as never }));
  });

  it("fails closed when truncation and continuation cursor state contradict each other or the requested limit", async () => {
    await expectGitHubPageRejected(githubPage({ truncated: true, nextCursor: null }));
    await expectGitHubPageRejected(githubPage({ truncated: false, nextCursor: GITHUB_CURSOR }));
    await expectGitHubPageRejected(githubPage({ truncated: true, nextCursor: GITHUB_CURSOR }), { limit: 2 });
  });

  it("requires pageKind to match whether the client supplied a continuation cursor", async () => {
    await expectGitHubPageRejected(githubPage({ pageKind: "continuation" }));
    await expectGitHubPageRejected(githubPage({ pageKind: "initial" }), { cursor: GITHUB_CURSOR });
  });

  it("recomputes and verifies pageHash over the exact public page", async () => {
    const tamperedHash = githubPage({}, "0".repeat(64));
    await expectGitHubPageRejected(tamperedHash);
  });

  it("performs no Slack or GitHub network write while listing GitHub compliance results", async () => {
    const services = serviceStubs();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("external fetch is forbidden"));
    try {
      const { client } = await connected(services);
      const response = await client.callTool({ name: "list_github_compliance_results", arguments: {} });

      expect(response.isError).not.toBe(true);
      expect(services.listGitHubComplianceResults).toHaveBeenCalledTimes(1);
      expect(services.postDailyDigest).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
