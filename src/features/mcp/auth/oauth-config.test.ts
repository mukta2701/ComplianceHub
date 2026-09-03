import { describe, expect, it } from "vitest";
import { parseMcpOAuthEnvironment } from "./oauth-config";

const production = {
  NODE_ENV: "production",
  MCP_RESOURCE_URL: "https://compliance.example/mcp",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_OAUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_OAUTH_JWKS_URL: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-key-with-sufficient-length",
  MCP_JWT_ALGORITHMS: "RS256,ES256",
};

describe("parseMcpOAuthEnvironment", () => {
  it("returns a canonical production resource without consulting request headers", () => {
    expect(parseMcpOAuthEnvironment(production)).toEqual({
      resource: "https://compliance.example/mcp",
      authorizationServer: "https://project.supabase.co/auth/v1",
      jwksUrl: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "publishable-key-with-sufficient-length",
      algorithms: ["RS256", "ES256"],
      scopes: ["openid", "email", "profile"],
    });
  });

  it.each([
    ["missing resource", { MCP_RESOURCE_URL: undefined }],
    ["non-TLS resource", { MCP_RESOURCE_URL: "http://compliance.example/mcp" }],
    ["wrong resource path", { MCP_RESOURCE_URL: "https://compliance.example/api/mcp" }],
    ["issuer mismatch", { SUPABASE_OAUTH_ISSUER: "https://attacker.example/auth/v1" }],
    ["JWKS mismatch", { SUPABASE_OAUTH_JWKS_URL: "https://attacker.example/jwks" }],
    ["symmetric algorithm", { MCP_JWT_ALGORITHMS: "HS256" }],
  ])("fails closed in production for %s", (_label, override) => {
    expect(() => parseMcpOAuthEnvironment({ ...production, ...override })).toThrow("MCP OAuth environment is invalid");
  });

  it("uses fixed loopback defaults outside production", () => {
    const value = parseMcpOAuthEnvironment({ NODE_ENV: "test" });
    expect(value.resource).toBe("http://127.0.0.1:3100/mcp");
    expect(value.authorizationServer).toBe("http://127.0.0.1:54321/auth/v1");
  });

  it("treats blank optional values like omitted local configuration", () => {
    const value = parseMcpOAuthEnvironment({
      NODE_ENV: "test",
      MCP_RESOURCE_URL: "  ",
      SUPABASE_OAUTH_ISSUER: "",
      SUPABASE_OAUTH_JWKS_URL: "",
      MCP_JWT_ALGORITHMS: "",
    });
    expect(value.resource).toBe("http://127.0.0.1:3100/mcp");
    expect(value.authorizationServer).toBe("http://127.0.0.1:54321/auth/v1");
    expect(value.jwksUrl).toBe("http://127.0.0.1:54321/auth/v1/.well-known/jwks.json");
    expect(value.algorithms).toEqual(["RS256", "ES256"]);
  });
});
