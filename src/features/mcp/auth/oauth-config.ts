import "server-only";
import { z } from "zod";

const allowedAlgorithms = new Set(["RS256", "ES256"] as const);
export type McpJwtAlgorithm = "RS256" | "ES256";

export type McpOAuthConfig = {
  resource: string;
  allowedOrigins: readonly string[];
  authorizationServer: string;
  jwksUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
  algorithms: McpJwtAlgorithm[];
  scopes: ["openid", "email", "profile"];
};

function configuredValue(environment: Record<string, string | undefined>, name: string) {
  const value = environment[name];
  return value?.trim() ? value : undefined;
}

function canonicalUrl(value: string, options: { production: boolean; path?: string }) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("unsafe URL");
  if (options.production ? url.protocol !== "https:" : !["https:", "http:"].includes(url.protocol)) throw new Error("unsafe protocol");
  if (options.path && url.pathname !== options.path) throw new Error("wrong path");
  return url.toString().replace(/\/$/, "");
}

type RawUrl = { authority: string; path: string };

function parseRawUrl(value: string): RawUrl {
  if (/[\u0000-\u001F\u007F]/.test(value) || value.includes("*") || value.includes("\\")) throw new Error("invalid URL syntax");
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(value);
  if (!match || match[1].includes("@") || match[1].includes("%")) throw new Error("invalid URL syntax");
  return { authority: match[1], path: match[2] ?? "" };
}

function hasExactLoopbackAuthority(authority: string) {
  return /^(?:127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(authority);
}

function validateRawMcpResource(value: string, production: boolean) {
  const raw = parseRawUrl(value);
  if (raw.path !== "/mcp") throw new Error("invalid resource path");
  if (!production && !hasExactLoopbackAuthority(raw.authority)) throw new Error("invalid local resource");
}

function canonicalAllowedOrigin(origin: string, production: boolean) {
  if (origin === "null") throw new Error("invalid origin");
  const raw = parseRawUrl(origin);
  if (raw.path !== "" && raw.path !== "/") throw new Error("invalid origin");
  if (!production && !hasExactLoopbackAuthority(raw.authority)) throw new Error("invalid local origin");
  const url = new URL(origin);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("invalid origin");
  if (production ? url.protocol !== "https:" : url.protocol !== "http:") throw new Error("invalid origin protocol");
  if (!production && !["127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("invalid local origin");
  return url.origin;
}

function parseAllowedOrigins(value: string | undefined, options: { production: boolean; resource: string }) {
  const origins = value === undefined
    ? [new URL(options.resource).origin]
    : value.split(",").map((item) => item.trim());
  if (!origins.length || origins.some((origin) => !origin)) throw new Error("invalid origin list");

  const canonicalOrigins = origins.map((origin) => canonicalAllowedOrigin(origin, options.production));
  if (new Set(canonicalOrigins).size !== canonicalOrigins.length) throw new Error("duplicate origin");
  return canonicalOrigins;
}

export function parseMcpOAuthEnvironment(environment: Record<string, string | undefined>): McpOAuthConfig {
  try {
    const production = environment.NODE_ENV === "production";
    const supabaseUrl = canonicalUrl(configuredValue(environment, "NEXT_PUBLIC_SUPABASE_URL") ?? (production ? "" : "http://127.0.0.1:54321"), { production });
    const expectedIssuer = `${supabaseUrl}/auth/v1`;
    const authorizationServer = canonicalUrl(configuredValue(environment, "SUPABASE_OAUTH_ISSUER") ?? (production ? "" : expectedIssuer), { production, path: "/auth/v1" });
    if (authorizationServer !== expectedIssuer) throw new Error("issuer mismatch");
    const expectedJwks = `${authorizationServer}/.well-known/jwks.json`;
    const jwksUrl = canonicalUrl(configuredValue(environment, "SUPABASE_OAUTH_JWKS_URL") ?? (production ? "" : expectedJwks), { production, path: "/auth/v1/.well-known/jwks.json" });
    if (jwksUrl !== expectedJwks) throw new Error("JWKS mismatch");
    const rawResource = configuredValue(environment, "MCP_RESOURCE_URL") ?? (production ? "" : "http://127.0.0.1:3100/mcp");
    validateRawMcpResource(rawResource, production);
    const resource = canonicalUrl(rawResource, { production, path: "/mcp" });
    const allowedOrigins = parseAllowedOrigins(configuredValue(environment, "MCP_ALLOWED_ORIGINS"), { production, resource });
    const supabaseKey = configuredValue(environment, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? configuredValue(environment, "NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? (production ? "" : "local-publishable-key-placeholder");
    z.string().min(20).parse(supabaseKey);
    const algorithms = (configuredValue(environment, "MCP_JWT_ALGORITHMS") ?? (production ? "" : "RS256,ES256"))
      .split(",").map((item) => item.trim()).filter(Boolean);
    if (!algorithms.length || algorithms.some((item) => !allowedAlgorithms.has(item as McpJwtAlgorithm))) throw new Error("algorithm mismatch");
    return { resource, allowedOrigins, authorizationServer, jwksUrl, supabaseUrl, supabaseKey, algorithms: [...new Set(algorithms)] as McpJwtAlgorithm[], scopes: ["openid", "email", "profile"] };
  } catch {
    throw new Error("MCP OAuth environment is invalid");
  }
}

export function getMcpOAuthConfig() {
  return parseMcpOAuthEnvironment(process.env);
}
