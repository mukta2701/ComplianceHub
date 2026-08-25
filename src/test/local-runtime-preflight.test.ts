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
      PLAYWRIGHT_PORT: "",
      ...environment,
    },
  });
}

function validEnvironment(overrides: Record<string, string> = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localSupabaseKey("anon"),
    SUPABASE_SERVICE_ROLE_KEY: localSupabaseKey("service_role"),
    APP_ENCRYPTION_KEY: localAppEncryptionKey,
    COMPLIANCEHUB_RELEASE_SHA: currentSha,
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
    const result = invoke(validEnvironment({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("matching local site URL");
    expect(result.stderr).not.toContain("localhost:3000");
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

  it("rejects an invalid app encryption key without printing it", () => {
    const result = invoke(validEnvironment({ APP_ENCRYPTION_KEY: "not-a-valid-32-byte-key" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("APP_ENCRYPTION_KEY");
    expect(result.stderr).not.toContain("not-a-valid-32-byte-key");
  });

  it("permits the exact isolated Playwright port without printing it", () => {
    const result = invoke(validEnvironment({
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      PLAYWRIGHT_PORT: "3100",
    }));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Local runtime preflight passed");
    expect(result.stdout).not.toContain("3100");
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
