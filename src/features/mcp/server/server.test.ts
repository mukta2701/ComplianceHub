import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpError } from "../auth/errors";
import { WorkspaceRequiredError } from "../application/workspace-access";
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
      facts: {
        schemaVersion: 1 as const, workspace: { id: WORKSPACE_ID, name: "Acme" }, localDate: "2026-08-07", overview: readiness,
        attentionItems: [], monitoringFindings: [], latestLeadershipReport: null,
        truncation: { attentionItems: false, monitoringFindings: false },
      },
      factHash: "a".repeat(64), delivery: null,
    })),
  };
}

async function connected(services = serviceStubs()) {
  const server = createComplianceMcpServer({ userId: USER_ID, supabase: {} as never, resource: RESOURCE }, services);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  servers.push(server);
  clients.push(client);
  return { client, services };
}

describe("ComplianceHub MCP server", () => {
  it("initializes with stable identity, safety-first instructions, and exactly six read tools", async () => {
    const { client } = await connected();
    expect(client.getServerVersion()).toEqual({ name: "compliancehub-internal", version: "1.0.0" });
    expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(MCP_SERVER_INSTRUCTIONS.slice(0, 512)).toMatch(/Supabase is canonical[\s\S]*closed-world[\s\S]*Never invent/);

    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      "list_workspaces", "get_compliance_overview", "list_attention_items",
      "list_monitoring_findings", "get_latest_leadership_report", "prepare_daily_digest",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(tool._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["openid", "email", "profile"] }]);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      if (tool.name !== "list_workspaces") expect(tool.inputSchema).toMatchObject({ additionalProperties: false });
      expect(tool.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
    expect(tools.find(({ name }) => name === "list_attention_items")?.inputSchema.properties).not.toHaveProperty("localDate");
    expect(tools.find(({ name }) => name === "get_compliance_overview")?.inputSchema.properties).not.toHaveProperty("localDate");
    expect(tools.find(({ name }) => name === "prepare_daily_digest")?.inputSchema.required).toContain("localDate");
  });

  it("calls all six tools with authenticated user context and returns stable structured content", async () => {
    const { client, services } = await connected();
    const calls = [
      ["list_workspaces", {}],
      ["get_compliance_overview", { workspaceId: WORKSPACE_ID }],
      ["list_attention_items", { workspaceId: WORKSPACE_ID, categories: ["overdue_task"], severity: "high", limit: 5 }],
      ["list_monitoring_findings", { workspaceId: WORKSPACE_ID, status: "open", severity: "critical", limit: 5 }],
      ["get_latest_leadership_report", { workspaceId: WORKSPACE_ID }],
      ["prepare_daily_digest", { workspaceId: WORKSPACE_ID, localDate: "2026-08-07" }],
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
    expect(services.prepareDailyDigest).toHaveBeenCalledWith(expect.anything(), USER_ID, { workspaceId: WORKSPACE_ID, localDate: "2026-08-07" });
  });

  it("maps strict-schema failures, workspace choices, and unknown exceptions to safe structured errors", async () => {
    const services = serviceStubs();
    vi.mocked(services.getComplianceOverview).mockRejectedValueOnce(new McpError("FORBIDDEN"));
    vi.mocked(services.listAttentionItems).mockRejectedValueOnce(new WorkspaceRequiredError([{ id: WORKSPACE_ID, name: "Acme", role: "owner" }]));
    vi.mocked(services.listMonitoringFindings).mockRejectedValueOnce(new Error("database password is secret"));
    const { client } = await connected(services);

    const invalid = await client.callTool({ name: "prepare_daily_digest", arguments: { localDate: "2026-02-30", extra: true } });
    expect(invalid).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "VALIDATION_ERROR" } } });
    const invalidEmpty = await client.callTool({ name: "list_workspaces", arguments: { extra: true } });
    expect(invalidEmpty).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "VALIDATION_ERROR" } } });
    const forbidden = await client.callTool({ name: "get_compliance_overview", arguments: {} });
    expect(forbidden).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "FORBIDDEN" } } });
    const choices = await client.callTool({ name: "list_attention_items", arguments: {} });
    expect(choices).toMatchObject({ isError: true, structuredContent: { error: { code: "WORKSPACE_REQUIRED", choices: [{ id: WORKSPACE_ID, name: "Acme" }] } } });
    const unknown = await client.callTool({ name: "list_monitoring_findings", arguments: {} });
    expect(unknown).toMatchObject({ isError: true, structuredContent: { error: { code: "INTERNAL_ERROR" } } });
    expect(JSON.stringify(unknown)).not.toContain("database password");
    for (const result of [invalid, invalidEmpty, forbidden, choices, unknown]) expect(result).not.toHaveProperty("_meta.mcp/www_authenticate");
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
});
