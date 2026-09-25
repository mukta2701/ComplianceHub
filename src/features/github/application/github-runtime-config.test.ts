import { describe, expect, it } from "vitest";
import { getGitHubConnectionConfig, getGitHubRuntimeReadiness, readGitHubRuntimeConfig } from "./github-runtime-config";

describe("GitHub runtime configuration", () => {
  it("reports readiness without exposing credentials", () => {
    const config = readGitHubRuntimeConfig({
      GITHUB_APP_ID: "123456",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "101,202",
    });
    expect(config).toEqual({ appId: "123456", privateKey: "private-key", approvedSecurityWorkflowIds: [101, 202] });
    expect(getGitHubRuntimeReadiness({
      GITHUB_APP_ID: "123456", GITHUB_APP_PRIVATE_KEY: "private-key", GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "101,202",
    })).toEqual({ available: true, status: "ready" });
  });

  it("reports unavailable when the app secret or approved workflow ids are missing or invalid", () => {
    expect(getGitHubRuntimeReadiness({ GITHUB_APP_ID: "123456", GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "101" })).toEqual({ available: false, status: "unavailable" });
    expect(getGitHubRuntimeReadiness({ GITHUB_APP_ID: "123456", GITHUB_APP_PRIVATE_KEY: "key", GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "01" })).toEqual({ available: false, status: "unavailable" });
  });
});

const COMPLETE_CONNECTION_ENV: Record<string, string> = {
  GITHUB_APP_ID: "123456",
  GITHUB_APP_SLUG: "compliancehub-app",
  GITHUB_APP_CLIENT_ID: "client-id",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_PRIVATE_KEY: "first-line\\nsecond-line",
  GITHUB_WEBHOOK_SECRET: "webhook-secret",
  GITHUB_ALLOWED_ACCOUNT_ID: "99",
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://compliance.example",
};

describe("GitHub connection configuration", () => {
  it("returns all eight connection values without altering the escaped private key", () => {
    expect(getGitHubConnectionConfig({ ...COMPLETE_CONNECTION_ENV })).toEqual({
      appId: "123456",
      appSlug: "compliancehub-app",
      clientId: "client-id",
      clientSecret: "client-secret",
      privateKey: "first-line\\nsecond-line",
      webhookSecret: "webhook-secret",
      allowedAccountId: 99,
      allowedAccountType: "Organization",
    });
  });

  it("allows the User account type only for the local development exception", () => {
    const config = getGitHubConnectionConfig({
      ...COMPLETE_CONNECTION_ENV,
      GITHUB_ALLOWED_ACCOUNT_TYPE: "User",
      NODE_ENV: "development",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
    });
    expect(config.allowedAccountType).toBe("User");
  });

  it.each([
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "GITHUB_ALLOWED_ACCOUNT_ID",
  ])("rejects a missing %s with the fixed redacted error", (name) => {
    const env = { ...COMPLETE_CONNECTION_ENV };
    delete env[name];
    expect(() => getGitHubConnectionConfig(env)).toThrow("GitHub collection is not configured");
  });

  it.each([
    ["malformed slug", { GITHUB_APP_SLUG: "Invalid_Slug!" }],
    ["zero account id", { GITHUB_ALLOWED_ACCOUNT_ID: "0" }],
    ["negative account id", { GITHUB_ALLOWED_ACCOUNT_ID: "-4" }],
    ["non-numeric account id", { GITHUB_ALLOWED_ACCOUNT_ID: "org-99" }],
    ["User type on a public origin", {
      GITHUB_ALLOWED_ACCOUNT_TYPE: "User",
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://compliance.example",
    }],
    ["User type on test env with a public origin", {
      GITHUB_ALLOWED_ACCOUNT_TYPE: "User",
      NODE_ENV: "test",
      NEXT_PUBLIC_SITE_URL: "https://compliance.example",
    }],
  ])("rejects %s without exposing configured values", (label, overrides) => {
    expect(() => getGitHubConnectionConfig({ ...COMPLETE_CONNECTION_ENV, ...overrides })).toThrow(
      "GitHub collection is not configured",
    );
  });

  it("never includes a secret value in the thrown error", () => {
    try {
      getGitHubConnectionConfig({ GITHUB_APP_CLIENT_SECRET: "client-secret" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("client-secret");
      expect(String(error)).toBe("GitHubRuntimeConfigError: GitHub collection is not configured");
    }
  });
});
