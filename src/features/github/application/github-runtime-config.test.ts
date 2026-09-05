import { describe, expect, it } from "vitest";
import { getGitHubRuntimeReadiness, readGitHubRuntimeConfig } from "./github-runtime-config";

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
