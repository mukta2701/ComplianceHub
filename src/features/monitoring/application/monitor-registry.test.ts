import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeMonitorProvider } from "../domain/monitor-provider";
import { githubMonitorProvider } from "./github-monitor";
import { resolveMonitorProvider } from "./monitor-registry";

describe("monitor provider mode routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps sandbox sources fake even when the old live flag is set", () => {
    vi.stubEnv("MONITORING_LIVE", "1");
    expect(resolveMonitorProvider({ provider: "github", connectionMode: "sandbox" })).toBe(fakeMonitorProvider);
  });

  it("routes OAuth sources to the Nango-backed monitor without a global flag", () => {
    vi.stubEnv("MONITORING_LIVE", "");
    expect(resolveMonitorProvider({ provider: "github", connectionMode: "oauth" })).toBe(githubMonitorProvider);
  });

  it("routes native Jira sources to the Jira provider", async () => {
    const jiraRequest = async () => ({ status: 200, data: { isLast: true, issues: [] } });
    const provider = resolveMonitorProvider(
      { provider: "jira", connectionMode: "jira_oauth" },
      { jiraRequest },
    );

    const checks = await provider.runChecks({
      id: "jira-source",
      provider: "jira",
      config: {
        baseUrl: "https://acme.atlassian.net",
        cloudId: "1324a887-45db-4bf4-8e99-ef0ff456d421",
        projectKey: "SEC",
      },
      connectionMode: "jira_oauth",
    });

    expect(checks).toHaveLength(3);
    expect(checks.every((check) => check.checkId.startsWith("jira."))).toBe(true);
  });
});
