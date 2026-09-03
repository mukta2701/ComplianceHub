import { createHash } from "node:crypto";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { JWTPayload } from "jose";
import { McpError, oauthErrorResponse } from "@/features/mcp/auth/errors";
import { getMcpOAuthConfig } from "@/features/mcp/auth/oauth-config";
import { authenticateMcpRequest, parseBearerToken } from "@/features/mcp/auth/request-auth";
import { createComplianceMcpServer, type McpRequestContext } from "@/features/mcp/server/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const MCP_MAX_BODY_BYTES = 256 * 1024;

type AuthenticatedMcpRequest = {
  user: User;
  claims: JWTPayload & { sub: string; client_id: string; session_id: string };
  supabase: SupabaseClient;
};

type McpRouteDependencies = {
  resource: string;
  authenticate: (request: Request) => Promise<AuthenticatedMcpRequest>;
  rateLimit: (key: string) => Promise<void>;
  createServer: (context: McpRequestContext) => McpServer;
};

type BoundedJsonBody = { parsedBody: unknown; bytes: Uint8Array };

class McpHttpRequestError extends Error {
  constructor(readonly status: number, readonly rpcCode: number, message: string) {
    super(message);
  }
}

function responseHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("cache-control", "no-store");
  result.set("x-robots-tag", "noindex, nofollow");
  return result;
}

function securedResponse(response: Response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response.headers),
  });
}

function jsonRpcError(status: number, code: number, message: string, data?: Record<string, unknown>) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0", id: null,
    error: { code, message, ...(data ? { data } : {}) },
  }), {
    status,
    headers: responseHeaders({ "content-type": "application/json" }),
  });
}

function applicationError(error: McpError) {
  return jsonRpcError(error.status, -32000, error.message, error.toStructuredContent().error);
}

async function readBoundedJson(request: Request): Promise<BoundedJsonBody> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new McpHttpRequestError(415, -32000, "Content-Type must be application/json.");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new McpHttpRequestError(400, -32000, "Invalid Content-Length.");
    if (length > MCP_MAX_BODY_BYTES) throw new McpHttpRequestError(413, -32000, "Request body is too large.");
  }
  if (!request.body) throw new McpHttpRequestError(400, -32700, "Request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MCP_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new McpHttpRequestError(413, -32000, "Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new McpHttpRequestError(400, -32700, "Request body is required.");
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { parsedBody: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)), bytes: body };
  } catch {
    throw new McpHttpRequestError(400, -32700, "Invalid JSON request.");
  }
}

function rateLimitKey(userId: string, clientId: string) {
  const digest = createHash("sha256").update(`${userId}\0${clientId}`, "utf8").digest("hex");
  return `mcp:${digest}`;
}

function tokenScopes(claims: JWTPayload): string[] {
  const scope = claims.scope;
  if (typeof scope === "string") return [...new Set(scope.split(/\s+/).filter(Boolean))];
  return [];
}

function defaultRouteDependencies(): McpRouteDependencies {
  const config = getMcpOAuthConfig();
  return {
    resource: config.resource,
    authenticate: (request) => authenticateMcpRequest(request, { config }),
    rateLimit: (key) => enforceRateLimit(key, { limit: 60, windowMs: 60_000 }),
    createServer: (context) => createComplianceMcpServer(context),
  };
}

function forwardedMcpHeaders(headers: Headers) {
  const result = new Headers();
  for (const name of ["accept", "authorization", "content-type", "mcp-method", "mcp-protocol-version"]) {
    const value = headers.get(name);
    if (value !== null) result.set(name, value);
  }
  return result;
}

export async function handleMcpPost(
  request: Request,
  dependencies: McpRouteDependencies = defaultRouteDependencies(),
): Promise<Response> {
  let authenticated: AuthenticatedMcpRequest;
  try {
    authenticated = await dependencies.authenticate(request);
  } catch (error) {
    const safe = error instanceof McpError ? error : new McpError("INTERNAL_ERROR");
    return securedResponse(oauthErrorResponse(safe, dependencies.resource));
  }

  const scopes = tokenScopes(authenticated.claims);
  if (!["openid", "email", "profile"].every((required) => scopes.includes(required))) {
    return securedResponse(oauthErrorResponse(new McpError("INVALID_TOKEN"), dependencies.resource));
  }

  try {
    await dependencies.rateLimit(rateLimitKey(authenticated.user.id, authenticated.claims.client_id));
  } catch {
    return applicationError(new McpError("RATE_LIMITED"));
  }

  let body: BoundedJsonBody;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof McpHttpRequestError) return jsonRpcError(error.status, error.rpcCode, error.message);
    return jsonRpcError(400, -32700, "Invalid JSON request.");
  }
  // V1 intentionally accepts exactly one JSON-RPC message per HTTP request.
  // Reject batches before constructing any MCP context or invoking SDK handlers.
  if (Array.isArray(body.parsedBody)) return jsonRpcError(400, -32600, "Invalid Request.");

  const handler = createMcpHandler(
    () => dependencies.createServer({
      userId: authenticated.user.id,
      clientId: authenticated.claims.client_id,
      supabase: authenticated.supabase,
      resource: dependencies.resource,
    }),
    { legacy: "stateless" },
  );
  const validatedBytes = new Uint8Array(body.bytes.byteLength);
  validatedBytes.set(body.bytes);
  const validatedRequest = new Request(request.url, {
    method: "POST",
    headers: forwardedMcpHeaders(request.headers),
    body: validatedBytes.buffer,
  });
  try {
    const response = await handler.fetch(validatedRequest, {
      parsedBody: body.parsedBody,
      authInfo: {
        token: parseBearerToken(request.headers.get("authorization")),
        clientId: authenticated.claims.client_id,
        scopes,
        expiresAt: authenticated.claims.exp,
        resource: new URL(dependencies.resource),
        extra: { userId: authenticated.user.id, sessionId: authenticated.claims.session_id },
      },
    });
    return securedResponse(response);
  } catch {
    return jsonRpcError(500, -32603, "Internal server error.");
  } finally {
    await handler.close().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  return handleMcpPost(request);
}

function methodNotAllowed() {
  return new Response(JSON.stringify({
    jsonrpc: "2.0", id: null,
    error: { code: -32000, message: "Method not allowed." },
  }), {
    status: 405,
    headers: responseHeaders({ "content-type": "application/json", allow: "POST" }),
  });
}

export async function GET() { return methodNotAllowed(); }
export async function DELETE() { return methodNotAllowed(); }
