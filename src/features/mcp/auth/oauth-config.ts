import "server-only";
import { z } from "zod";

const allowedAlgorithms = new Set(["RS256", "ES256"] as const);
export type McpJwtAlgorithm = "RS256" | "ES256";

export type McpOAuthConfig = {
  resource: string;
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
    const resource = canonicalUrl(
      configuredValue(environment, "MCP_RESOURCE_URL")
        ?? (production ? "" : "http://127.0.0.1:3100/mcp"),
      { production, path: "/mcp" },
    );
    const supabaseKey = configuredValue(environment, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? configuredValue(environment, "NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? (production ? "" : "local-publishable-key-placeholder");
    z.string().min(20).parse(supabaseKey);
    const algorithms = (configuredValue(environment, "MCP_JWT_ALGORITHMS") ?? (production ? "" : "RS256,ES256"))
      .split(",").map((item) => item.trim()).filter(Boolean);
    if (!algorithms.length || algorithms.some((item) => !allowedAlgorithms.has(item as McpJwtAlgorithm))) throw new Error("algorithm mismatch");
    return { resource, authorizationServer, jwksUrl, supabaseUrl, supabaseKey, algorithms: [...new Set(algorithms)] as McpJwtAlgorithm[], scopes: ["openid", "email", "profile"] };
  } catch {
    throw new Error("MCP OAuth environment is invalid");
  }
}

export function getMcpOAuthConfig() {
  return parseMcpOAuthEnvironment(process.env);
}
