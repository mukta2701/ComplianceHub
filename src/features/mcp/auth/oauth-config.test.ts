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
      allowedOrigins: ["https://compliance.example"],
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
    expect(value.allowedOrigins).toEqual(["http://127.0.0.1:3100"]);
    expect(value.authorizationServer).toBe("http://127.0.0.1:54321/auth/v1");
  });

  it.each([
    ["TLS resource", "https://attacker.example/mcp"],
    ["non-loopback HTTP resource", "http://attacker.example/mcp"],
  ])("fails closed when a %s derives the local browser-origin default", (_label, MCP_RESOURCE_URL) => {
    expect(() => parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_RESOURCE_URL })).toThrow("MCP OAuth environment is invalid");
  });

  it("allows an explicitly configured exact browser origin", () => {
    const local = parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_ALLOWED_ORIGINS: "http://127.0.0.1:3100" });
    const hosted = parseMcpOAuthEnvironment({ ...production, MCP_ALLOWED_ORIGINS: "https://compliance.example" });

    expect(local.allowedOrigins).toEqual(["http://127.0.0.1:3100"]);
    expect(hosted.allowedOrigins).toEqual(["https://compliance.example"]);
  });

  it.each([
    ["null", "null"],
    ["wildcard", "*"],
    ["credentials", "https://user:password@compliance.example"],
    ["path", "https://compliance.example/mcp"],
    ["query", "https://compliance.example?next=attacker"],
    ["fragment", "https://compliance.example#attacker"],
    ["duplicate", "https://compliance.example, https://compliance.example/"],
    ["malformed", "not a URL"],
    ["non-TLS hosted origin", "http://compliance.example"],
  ])("fails closed for a %s configured production browser origin", (_label, MCP_ALLOWED_ORIGINS) => {
    expect(() => parseMcpOAuthEnvironment({ ...production, MCP_ALLOWED_ORIGINS })).toThrow("MCP OAuth environment is invalid");
  });

  it.each([
    ["non-loopback host", "http://localhost:3100"],
    ["TLS local origin", "https://127.0.0.1:3100"],
    ["deceptive loopback suffix", "http://127.0.0.1:3100.attacker.example"],
  ])("fails closed for a %s configured local browser origin", (_label, MCP_ALLOWED_ORIGINS) => {
    expect(() => parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_ALLOWED_ORIGINS })).toThrow("MCP OAuth environment is invalid");
  });

  it.each([
    ["non-canonical scheme separator", "http:127.0.0.1:3100"],
    ["encoded dot path", "http://127.0.0.1:3100/%2e"],
    ["normalized dot-segment path", "http://127.0.0.1:3100/a/.."],
    ["empty query marker", "http://127.0.0.1:3100?"],
    ["empty fragment marker", "http://127.0.0.1:3100#"],
    ["empty userinfo marker", "http://@127.0.0.1:3100"],
  ])("fails closed for raw local %s that URL normalization could erase", (_label, MCP_ALLOWED_ORIGINS) => {
    expect(() => parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_ALLOWED_ORIGINS })).toThrow("MCP OAuth environment is invalid");
  });

  it.each([
    ["non-canonical scheme separator", "https:compliance.example"],
    ["encoded dot path", "https://compliance.example/%2e"],
    ["normalized dot-segment path", "https://compliance.example/a/.."],
    ["empty query marker", "https://compliance.example?"],
    ["empty fragment marker", "https://compliance.example#"],
    ["empty userinfo marker", "https://@compliance.example"],
  ])("fails closed for raw hosted %s that URL normalization could erase", (_label, MCP_ALLOWED_ORIGINS) => {
    expect(() => parseMcpOAuthEnvironment({ ...production, MCP_ALLOWED_ORIGINS })).toThrow("MCP OAuth environment is invalid");
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
