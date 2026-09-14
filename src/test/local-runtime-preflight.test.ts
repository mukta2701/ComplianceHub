import { existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/preflight-local-runtime.sh");
const currentSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const localAppEncryptionKey = Buffer.alloc(32, 7).toString("base64");

function localSupabaseKey(role: "anon" | "service_role", reference = "local-compliancehub") {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role, ref: reference })).toString("base64url");
  return `${header}.${payload}.test-signature`;
}

function localDevelopmentSupabaseKey(
  role: "anon" | "service_role",
  overrides: Record<string, unknown> = {},
) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    role,
    iss: "supabase-demo",
    exp: Math.floor(Date.now() / 1_000) + 3_600,
    ...overrides,
  })).toString("base64url");
  return `${header}.${payload}.test-signature`;
}

function invoke(environment: Record<string, string>) {
  return spawnSync(script, [], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SITE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      APP_ENCRYPTION_KEY: "",
      COMPLIANCEHUB_RELEASE_SHA: "",
      MCP_RESOURCE_URL: "",
      PLAYWRIGHT_PORT: "",
      ...environment,
    },
  });
}

function validEnvironment(overrides: Record<string, string> = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localSupabaseKey("anon"),
    SUPABASE_SERVICE_ROLE_KEY: localSupabaseKey("service_role"),
    APP_ENCRYPTION_KEY: localAppEncryptionKey,
    COMPLIANCEHUB_RELEASE_SHA: currentSha,
    MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp",
    ...overrides,
  };
}

describe("local runtime preflight", () => {
  it("provides an explicit guard before a local browser run", () => {
    expect(existsSync("scripts/preflight-local-runtime.sh")).toBe(true);
  });

  it("permits only an explicit loopback Supabase target and the checked-out release SHA", () => {
    const result = invoke(validEnvironment());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Local runtime preflight passed");
    expect(result.stdout).not.toContain("127.0.0.1:54321");
  });

  it("rejects a non-loopback database URL without printing it", () => {
    const result = invoke(validEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "https://hosted-project.supabase.co",
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("non-loopback Supabase URL");
    expect(result.stderr).not.toContain("hosted-project.supabase.co");
  });

  it("rejects a stale release SHA without printing it", () => {
    const result = invoke(validEnvironment({
      COMPLIANCEHUB_RELEASE_SHA: "0000000000000000000000000000000000000000",
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("checked-out source");
    expect(result.stderr).not.toContain("0000000000000000000000000000000000000000");
  });

  it("rejects a hosted or mismatched local site origin without printing it", () => {
    const result = invoke(validEnvironment({ NEXT_PUBLIC_SITE_URL: "http://localhost:3100" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("matching local site URL");
    expect(result.stderr).not.toContain("localhost:3100");
  });

  it("rejects missing or mixed Supabase keys without printing them", () => {
    const missing = invoke(validEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "" }));
    const mixed = invoke(validEnvironment({
      SUPABASE_SERVICE_ROLE_KEY: localSupabaseKey("service_role", "different-local-stack"),
    }));

    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("local Supabase keys");
    expect(mixed.status).not.toBe(0);
    expect(mixed.stderr).toContain("same local Supabase stack");
    expect(mixed.stderr).not.toContain("different-local-stack");
  });

  it("permits role-correct local Supabase development keys without a project ref", () => {
    const result = invoke(validEnvironment({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: localDevelopmentSupabaseKey("anon"),
      SUPABASE_SERVICE_ROLE_KEY: localDevelopmentSupabaseKey("service_role"),
    }));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Local runtime preflight passed");
    expect(result.stdout).not.toContain("supabase-demo");
  });

  it("rejects mixed development and project-ref Supabase keys without printing either identity", () => {
    const result = invoke(validEnvironment({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: localDevelopmentSupabaseKey("anon"),
      SUPABASE_SERVICE_ROLE_KEY: localSupabaseKey("service_role", "local-compliancehub"),
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("same local Supabase stack");
    expect(result.stderr).not.toContain("supabase-demo");
    expect(result.stderr).not.toContain("local-compliancehub");
  });

  it("rejects expired or algorithm-confused local development keys", () => {
    const expired = invoke(validEnvironment({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: localDevelopmentSupabaseKey("anon", { exp: 1 }),
      SUPABASE_SERVICE_ROLE_KEY: localDevelopmentSupabaseKey("service_role"),
    }));
    const unsignedHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const badAlgorithm = invoke(validEnvironment({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: `${unsignedHeader}.${Buffer.from(JSON.stringify({
        role: "anon", iss: "supabase-demo", exp: Math.floor(Date.now() / 1_000) + 3_600,
      })).toString("base64url")}.test-signature`,
      SUPABASE_SERVICE_ROLE_KEY: localDevelopmentSupabaseKey("service_role"),
    }));

    expect(expired.status).not.toBe(0);
    expect(expired.stderr).toContain("valid local Supabase keys");
    expect(badAlgorithm.status).not.toBe(0);
    expect(badAlgorithm.stderr).toContain("valid local Supabase keys");
    expect(badAlgorithm.stderr).not.toContain("supabase-demo");
  });

  it("rejects an invalid app encryption key without printing it", () => {
    const result = invoke(validEnvironment({ APP_ENCRYPTION_KEY: "not-a-valid-32-byte-key" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("APP_ENCRYPTION_KEY");
    expect(result.stderr).not.toContain("not-a-valid-32-byte-key");
  });

  it("permits the exact isolated Playwright port without printing it", () => {
    const result = invoke(validEnvironment({
      MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      PLAYWRIGHT_PORT: "3100",
    }));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Local runtime preflight passed");
    expect(result.stdout).not.toContain("3100");
  });

  it.each([
    ["missing", ""],
    ["wrong local port", "http://127.0.0.1:3000/mcp"],
    ["wrong path", "http://127.0.0.1:3100/api/mcp"],
    ["hosted", "https://hosted-project.example/mcp"],
  ])("rejects a %s MCP resource without printing it", (_label, resource) => {
    const result = invoke(validEnvironment({
      MCP_RESOURCE_URL: resource,
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      PLAYWRIGHT_PORT: "3100",
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("matching local MCP resource");
    if (resource) expect(result.stderr).not.toContain(resource);
  });

  it("rejects a malformed Playwright port without printing it", () => {
    const result = invoke(validEnvironment({
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      PLAYWRIGHT_PORT: "3100;hosted-project",
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PLAYWRIGHT_PORT");
    expect(result.stderr).not.toContain("3100;hosted-project");
  });
});
