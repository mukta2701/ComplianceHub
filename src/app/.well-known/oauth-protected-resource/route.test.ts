import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/oauth-protected-resource", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("advertises only the canonical MCP resource and identity scopes", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await GET();
    expect(await response.json()).toEqual({
      resource: "http://localhost:3000/mcp",
      authorization_servers: ["http://127.0.0.1:54321/auth/v1"],
      scopes_supported: ["openid", "email", "profile"],
      bearer_methods_supported: ["header"],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
