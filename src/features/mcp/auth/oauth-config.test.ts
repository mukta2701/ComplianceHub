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
    ["alternate 127/8 resource", "http://127.0.0.2:3100/mcp"],
  ])("fails closed when a %s derives the local browser-origin default", (_label, MCP_RESOURCE_URL) => {
    expect(() => parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_RESOURCE_URL })).toThrow("MCP OAuth environment is invalid");
  });

  it.each([
    ["backslash path separator", "http://127.0.0.1:3100\\mcp"],
    ["normalized dot-segment path", "http://127.0.0.1:3100/a/../mcp"],
    ["encoded dot path", "http://127.0.0.1:3100/%2e/mcp"],
    ["userinfo marker", "http://@127.0.0.1:3100/mcp"],
    ["empty query marker", "http://127.0.0.1:3100/mcp?"],
    ["empty fragment marker", "http://127.0.0.1:3100/mcp#"],
    ["embedded tab", "http://127.0.0.1:3100/m\tcp"],
    ["embedded newline", "http://127.0.0.1:3100/m\ncp"],
    ["embedded control whitespace", "http://127.0.0.1:3100/m\u000bcp"],
  ])("fails closed for raw configured local resource with %s", (_label, MCP_RESOURCE_URL) => {
    expect(() => parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_RESOURCE_URL })).toThrow("MCP OAuth environment is invalid");
  });

  it.each([
    ["backslash path separator", "https://compliance.example\\mcp"],
    ["encoded hostname label", "https://%63ompliance.example/mcp"],
    ["encoded hostname separator", "https://compliance%2eexample/mcp"],
    ["empty query marker", "https://compliance.example/mcp?"],
    ["embedded tab", "https://compliance.example/m\tcp"],
  ])("fails closed for raw configured production resource with %s", (_label, MCP_RESOURCE_URL) => {
    expect(() => parseMcpOAuthEnvironment({ ...production, MCP_RESOURCE_URL })).toThrow("MCP OAuth environment is invalid");
  });

  it("allows literal IPv4 and IPv6 loopback origins outside production", () => {
    const explicitIpv6 = parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_ALLOWED_ORIGINS: "http://[::1]:3100" });
    const resourceDerivedIpv6 = parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_RESOURCE_URL: "http://[::1]:3100/mcp" });

    expect(explicitIpv6.allowedOrigins).toEqual(["http://[::1]:3100"]);
    expect(resourceDerivedIpv6.allowedOrigins).toEqual(["http://[::1]:3100"]);
  });

  it("allows an explicitly configured exact browser origin", () => {
    const local = parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_ALLOWED_ORIGINS: "http://127.0.0.1:3100" });
    const hosted = parseMcpOAuthEnvironment({ ...production, MCP_ALLOWED_ORIGINS: "https://compliance.example" });

    expect(local.allowedOrigins).toEqual(["http://127.0.0.1:3100"]);
    expect(hosted.allowedOrigins).toEqual(["https://compliance.example"]);
  });

  it("preserves canonical production DNS, port, and IPv6 authorities", () => {
    const canonicalDns = parseMcpOAuthEnvironment({
      ...production,
      MCP_RESOURCE_URL: "https://Compliance.Example:443/mcp",
    });
    const customPort = parseMcpOAuthEnvironment({
      ...production,
      MCP_RESOURCE_URL: "https://compliance.example:8443/mcp",
    });
    const ipv6 = parseMcpOAuthEnvironment({
      ...production,
      MCP_RESOURCE_URL: "https://[2001:db8::1]:8443/mcp",
    });

    expect(canonicalDns.resource).toBe("https://compliance.example/mcp");
    expect(canonicalDns.allowedOrigins).toEqual(["https://compliance.example"]);
    expect(customPort.allowedOrigins).toEqual(["https://compliance.example:8443"]);
    expect(ipv6.allowedOrigins).toEqual(["https://[2001:db8::1]:8443"]);
  });

  it.each([
    ["null", "null"],
    ["wildcard", "*"],
    ["encoded hostname label", "https://%63ompliance.example"],
    ["encoded hostname separator", "https://compliance%2eexample"],
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
    ["alternate 127/8 address", "http://127.0.0.2:3100"],
    ["TLS local origin", "https://127.0.0.1:3100"],
    ["deceptive loopback suffix", "http://127.0.0.1:3100.attacker.example"],
  ])("fails closed for a %s configured local browser origin", (_label, MCP_ALLOWED_ORIGINS) => {
    expect(() => parseMcpOAuthEnvironment({ NODE_ENV: "test", MCP_ALLOWED_ORIGINS })).toThrow("MCP OAuth environment is invalid");
  });

  it.each([
    ["numeric IPv4 alias", { NODE_ENV: "test" }, "http://2130706433:3100"],
    ["embedded tab", { NODE_ENV: "test" }, "http://127.0.0.1:\t3100"],
    ["embedded newline", production, "https://compliance.example:\n443"],
  ])("fails closed for a %s configured browser origin with raw control or authority alias", (_label, environment, MCP_ALLOWED_ORIGINS) => {
    expect(() => parseMcpOAuthEnvironment({ ...environment, MCP_ALLOWED_ORIGINS })).toThrow("MCP OAuth environment is invalid");
  });

  it.each([
    ["non-canonical scheme separator", "http:127.0.0.1:3100"],
    ["trailing backslash", "http://127.0.0.1:3100\\"],
    ["backslash dot path", "http://127.0.0.1:3100\\..\\"],
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
    ["trailing backslash", "https://compliance.example\\"],
    ["backslash encoded dot path", "https://compliance.example\\%2e"],
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
