import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGitHubConnectionConfig,
  getGitHubRuntimeReadiness,
  readGitHubRuntimeConfig,
} from "./github-runtime-config";

const CLIENT_CREDENTIAL = crypto.randomUUID();
const PRIVATE_KEY_BODY = crypto.randomUUID();
const PRIVATE_KEY = `-----BEGIN PRIVATE ${"KEY"}-----\n${PRIVATE_KEY_BODY}\n-----END PRIVATE ${"KEY"}-----`;
const WEBHOOK_CREDENTIAL = crypto.randomUUID();

const CONNECTION_ENVIRONMENT = {
  GITHUB_APP_ID: "123456",
  GITHUB_APP_SLUG: "compliancehub-app",
  GITHUB_APP_CLIENT_ID: "Iv1.fixture-client-id",
  GITHUB_APP_CLIENT_SECRET: CLIENT_CREDENTIAL,
  GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY.replace(/\n/g, "\\n"),
  GITHUB_WEBHOOK_SECRET: WEBHOOK_CREDENTIAL,
  GITHUB_ALLOWED_ACCOUNT_ID: "987654321",
  GITHUB_ALLOWED_ACCOUNT_TYPE: "Organization",
} as const;

describe("GitHub runtime configuration", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(CONNECTION_ENVIRONMENT)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://compliance.example");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns the complete server-only connection contract and normalises escaped PEM newlines", () => {
    expect(getGitHubConnectionConfig()).toEqual({
      appId: "123456",
      appSlug: "compliancehub-app",
      clientId: "Iv1.fixture-client-id",
      clientSecret: CLIENT_CREDENTIAL,
      privateKey: PRIVATE_KEY,
      webhookSecret: WEBHOOK_CREDENTIAL,
      allowedAccountId: 987654321,
      allowedAccountType: "Organization",
    });
  });

  it.each(Object.keys(CONNECTION_ENVIRONMENT))(
    "fails with one fixed redacted error when %s is missing",
    (missingName) => {
      vi.stubEnv(missingName, undefined);

      const error = (() => {
        try {
          getGitHubConnectionConfig();
        } catch (caught) {
          return caught;
        }
      })();

      expect(String(error)).toBe("Error: GitHub connection is not configured");
      expect(String(error)).not.toContain(CLIENT_CREDENTIAL);
      expect(String(error)).not.toContain(PRIVATE_KEY_BODY);
      expect(String(error)).not.toContain(WEBHOOK_CREDENTIAL);
    },
  );

  it.each(["0", "-1", "1.5", "9007199254740992"])(
    "rejects a non-positive-safe allowed account ID: %s",
    (accountId) => {
      vi.stubEnv("GITHUB_ALLOWED_ACCOUNT_ID", accountId);

      expect(() => getGitHubConnectionConfig())
        .toThrow("GitHub connection is not configured");
    },
  );

  it.each(["development", "test"])(
    "allows the explicit User account exception only on local loopback in %s",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3100");
      vi.stubEnv("GITHUB_ALLOWED_ACCOUNT_TYPE", "User");

      expect(getGitHubConnectionConfig().allowedAccountType).toBe("User");
    },
  );

  it.each([
    ["production", "http://127.0.0.1:3100"],
    ["test", "https://compliance.example"],
    ["development", "https://compliance.example"],
  ])("rejects the User exception in %s at %s", (nodeEnv, siteUrl) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
    vi.stubEnv("GITHUB_ALLOWED_ACCOUNT_TYPE", "User");

    expect(() => getGitHubConnectionConfig())
      .toThrow("GitHub connection is not configured");
  });

  it("keeps collection-only workflow configuration separate", () => {
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

  it("reports collection unavailable when the app secret or approved workflow ids are missing or invalid", () => {
    expect(getGitHubRuntimeReadiness({ GITHUB_APP_ID: "123456", GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "101" })).toEqual({ available: false, status: "unavailable" });
    expect(getGitHubRuntimeReadiness({ GITHUB_APP_ID: "123456", GITHUB_APP_PRIVATE_KEY: "key", GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "01" })).toEqual({ available: false, status: "unavailable" });
  });
});
