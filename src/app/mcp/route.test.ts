import { describe, expect, it, vi } from "vitest";
import { oauthChallenge } from "@/features/mcp/auth/errors";
import { createComplianceMcpServer } from "@/features/mcp/server/server";
import { parseBearerToken } from "@/features/mcp/auth/request-auth";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DELETE, GET, handleMcpPost, MCP_MAX_BODY_BYTES } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const RESOURCE = "https://compliance.example/mcp";
const initialize = JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "route-test", version: "1.0.0" } },
});

function authContext(userId = USER_ID, clientId = "codex-client") {
  return {
    user: { id: userId } as never,
    claims: { sub: userId, client_id: clientId, session_id: "50000000-0000-4000-8000-000000000001", exp: 2_000_000_000, scope: "openid email profile" },
    supabase: {} as never,
  };
}

function request(body = initialize, headers: Record<string, string> = {}) {
  return new Request(RESOURCE, {
    method: "POST", body,
    headers: { authorization: "Bearer valid.token.value", "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    resource: RESOURCE,
    authenticate: vi.fn(async () => authContext()),
    rateLimit: vi.fn(async (key: string) => { void key; }),
    createServer: vi.fn((context: Parameters<typeof createComplianceMcpServer>[0]) => createComplianceMcpServer(context, {
      listWorkspaces: vi.fn(async () => []),
      getComplianceOverview: vi.fn(), listAttentionItems: vi.fn(), listMonitoringFindings: vi.fn(),
      listGitHubComplianceResults: vi.fn(), getLatestLeadershipReport: vi.fn(), prepareDailyDigest: vi.fn(), postDailyDigest: vi.fn(),
    })),
    createTransport: vi.fn(() => new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })),
    ...overrides,
  };
}

describe("POST /mcp", () => {
  it("authenticates, rate limits by user and client, and completes a stateless initialize without caching", async () => {
    const deps = dependencies();
    const response = await handleMcpPost(request(), deps as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "compliancehub-internal", version: "0.3.0" } } });
    expect(deps.authenticate).toHaveBeenCalledTimes(1);
    expect(deps.rateLimit).toHaveBeenCalledWith(expect.stringMatching(/^mcp:/));
    expect(deps.createServer).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, clientId: "codex-client" }));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("serves tool discovery statelessly with both current and SDK-compatible OAuth metadata", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const response = await handleMcpPost(request(body), dependencies() as never);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.tools).toHaveLength(8);
    for (const tool of payload.result.tools) {
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["openid", "email", "profile"] }]);
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
      if (tool.name !== "post_daily_digest") expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    }
  });

  it("serves ordinary single tool calls and notifications without treating them as batches", async () => {
    const deps = dependencies();
    const call = JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "list_workspaces", arguments: {} },
    });
    const callResponse = await handleMcpPost(request(call), deps as never);
    expect(callResponse.status).toBe(200);
    await expect(callResponse.json()).resolves.toMatchObject({
      jsonrpc: "2.0", id: 3,
      result: { structuredContent: { ok: true, data: { workspaces: [] } } },
    });

    const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
    const notificationResponse = await handleMcpPost(request(notification), deps as never);
    expect(notificationResponse.status).toBe(202);
    expect(await notificationResponse.text()).toBe("");
    expect(deps.createServer).toHaveBeenCalledTimes(2);
    expect(deps.createTransport).toHaveBeenCalledTimes(2);
  });

  it("rejects every JSON-RPC batch shape before creating a server or transport", async () => {
    const calls = Array.from({ length: 1_000 }, (_, index) => ({
      jsonrpc: "2.0", id: index + 1, method: "tools/call",
      params: { name: "list_workspaces", arguments: {} },
    }));
    const bodies = [
      "[]",
      JSON.stringify([JSON.parse(initialize)]),
      JSON.stringify([{ jsonrpc: "2.0", method: "notifications/initialized" }]),
      JSON.stringify(calls),
    ];
    expect(new TextEncoder().encode(bodies[3]).byteLength).toBeLessThan(MCP_MAX_BODY_BYTES);

    for (const body of bodies) {
      const deps = dependencies();
      const response = await handleMcpPost(request(body), deps as never);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        jsonrpc: "2.0", id: null,
        error: { code: -32600, message: "Invalid Request." },
      });
      expect(deps.authenticate).toHaveBeenCalledTimes(1);
      expect(deps.rateLimit).toHaveBeenCalledTimes(1);
      expect(deps.createServer).not.toHaveBeenCalled();
      expect(deps.createTransport).not.toHaveBeenCalled();
    }
  });

  it("cannot turn concurrent batch requests into concurrent MCP contexts", async () => {
    const deps = dependencies();
    const oneElementBatch = JSON.stringify([JSON.parse(initialize)]);
    const responses = await Promise.all(Array.from({ length: 20 }, () => handleMcpPost(request(oneElementBatch), deps as never)));
    expect(responses.every(({ status }) => status === 400)).toBe(true);
    expect(deps.authenticate).toHaveBeenCalledTimes(20);
    expect(deps.rateLimit).toHaveBeenCalledTimes(20);
    expect(deps.createServer).not.toHaveBeenCalled();
    expect(deps.createTransport).not.toHaveBeenCalled();
  });

  it("returns exact OAuth challenges for absent, malformed, and rejected bearer tokens", async () => {
    const candidates = [
      { candidate: new Request("https://attacker.example/mcp", { method: "POST", body: initialize, headers: { "content-type": "application/json" } }), code: "AUTH_REQUIRED" as const },
      { candidate: request(initialize, { authorization: "Basic secret" }), code: "INVALID_TOKEN" as const },
    ];
    for (const { candidate, code } of candidates) {
      const deps = dependencies({ authenticate: vi.fn(async (incoming: Request) => {
        parseBearerToken(incoming.headers.get("authorization"));
        return authContext();
      }) });
      const response = await handleMcpPost(candidate, deps as never);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(oauthChallenge(RESOURCE, code === "INVALID_TOKEN" ? "invalid_token" : undefined));
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code } });
    }
  });

  it("rejects authenticated tokens missing an advertised OAuth scope", async () => {
    const context = authContext();
    context.claims.scope = "openid email";
    const response = await handleMcpPost(request(), dependencies({ authenticate: vi.fn(async () => context) }) as never);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(oauthChallenge(RESOURCE, "invalid_token"));
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_TOKEN" } });
  });

  it("rejects wrong content types, missing, oversized, chunked oversized, and invalid JSON bodies safely", async () => {
    const oversized = "x".repeat(MCP_MAX_BODY_BYTES + 1);
    const cases = [
      request("{}", { "content-type": "text/plain" }),
      new Request(RESOURCE, { method: "POST", headers: { authorization: "Bearer valid.token.value", "content-type": "application/json" } }),
      request(oversized, { "content-length": String(oversized.length) }),
      request(oversized),
      request("{not-json"),
    ];
    for (const [index, candidate] of cases.entries()) {
      const response = await handleMcpPost(candidate, dependencies() as never);
      expect(response.status).toBe([415, 400, 413, 413, 400][index]);
      await expect(response.json()).resolves.toMatchObject({ jsonrpc: "2.0", id: null, error: { message: expect.any(String) } });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("maps the rate limit to RATE_LIMITED without leaking details", async () => {
    const deps = dependencies({ rateLimit: vi.fn(async () => { throw new Error("store credential"); }) });
    const response = await handleMcpPost(request(), deps as never);
    expect(response.status).toBe(429);
    const body = await response.text();
    expect(body).toContain("RATE_LIMITED");
    expect(body).not.toContain("credential");
  });

  it("uses fresh server and transport state for concurrent users", async () => {
    const servers: unknown[] = [];
    let call = 0;
    const deps = dependencies({
      authenticate: vi.fn(async () => authContext(call++ === 0 ? USER_ID : "10000000-0000-4000-8000-000000000002", `client-${call}`)),
      createServer: vi.fn((context: Parameters<typeof createComplianceMcpServer>[0]) => {
        const server = createComplianceMcpServer(context, { listWorkspaces: vi.fn(async () => []), getComplianceOverview: vi.fn(), listAttentionItems: vi.fn(), listMonitoringFindings: vi.fn(), listGitHubComplianceResults: vi.fn(), getLatestLeadershipReport: vi.fn(), prepareDailyDigest: vi.fn(), postDailyDigest: vi.fn() });
        servers.push(server);
        return server;
      }),
    });
    const responses = await Promise.all([handleMcpPost(request(), deps as never), handleMcpPost(request(), deps as never)]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(new Set(servers).size).toBe(2);
    expect(deps.createServer).toHaveBeenCalledTimes(2);
    expect(deps.createTransport).toHaveBeenCalledTimes(2);
    expect(deps.createTransport.mock.results[0]?.value).not.toBe(deps.createTransport.mock.results[1]?.value);
    expect(deps.rateLimit).toHaveBeenCalledTimes(2);
    expect(deps.rateLimit.mock.calls[0]?.[0]).not.toBe(deps.rateLimit.mock.calls[1]?.[0]);
  });
});

describe("unsupported MCP methods", () => {
  it("returns explicit no-store 405 responses for GET and DELETE", async () => {
    for (const response of [await GET(), await DELETE()]) {
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({ jsonrpc: "2.0", id: null, error: { message: "Method not allowed." } });
    }
  });
});
