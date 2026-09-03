import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/oauth-protected-resource", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("advertises only the canonical MCP resource and identity scopes", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-publishable-key-placeholder");
    vi.stubEnv("SUPABASE_OAUTH_ISSUER", "http://127.0.0.1:54321/auth/v1");
    vi.stubEnv("SUPABASE_OAUTH_JWKS_URL", "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json");
    vi.stubEnv("MCP_RESOURCE_URL", "http://127.0.0.1:3100/mcp");
    vi.stubEnv("MCP_JWT_ALGORITHMS", "RS256,ES256");
    const response = await GET();
    expect(await response.json()).toEqual({
      resource: "http://127.0.0.1:3100/mcp",
      authorization_servers: ["http://127.0.0.1:54321/auth/v1"],
      scopes_supported: ["openid", "email", "profile"],
      bearer_methods_supported: ["header"],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
