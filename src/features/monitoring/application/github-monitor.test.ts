import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonitorConnection } from "../domain/monitor-provider";
import { githubMonitorProvider } from "./github-monitor";

const connection: MonitorConnection = {
  id: "source-1",
  provider: "github",
  config: { owner: "acme", repo: "isms" },
  accessToken: "",
  connectionMode: "oauth",
  brokerConnectionId: "connection-1",
  brokerProviderConfigKey: "github-prod",
};

describe("GitHub OAuth compliance monitor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("runs fixed repository and organisation checks through Nango", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "server-secret");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        default_branch: "main",
        security_and_analysis: { secret_scanning: { status: "enabled" } },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        required_pull_request_reviews: { required_approving_review_count: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ two_factor_requirement_enabled: true }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchImpl);

    const checks = await githubMonitorProvider.runChecks(connection);

    expect(checks.map((check) => [check.checkId, check.passed])).toEqual([
      ["github.branch_protection", true],
      ["github.required_reviews", true],
      ["github.secret_scanning", true],
      ["github.org_mfa", true],
    ]);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://api.nango.dev/proxy/repos/acme/isms",
      "https://api.nango.dev/proxy/repos/acme/isms/branches/main/protection",
      "https://api.nango.dev/proxy/orgs/acme",
    ]);
  });

  it("reports permission-limited checks as unsupported failures instead of fabricating passes", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "server-secret");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ default_branch: "main" }), {
        status: 200, headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ login: "acme" }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchImpl);

    const checks = await githubMonitorProvider.runChecks(connection);

    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: "github.branch_protection", passed: false, detail: expect.stringContaining("permission") }),
      expect.objectContaining({ checkId: "github.required_reviews", passed: false, detail: expect.stringContaining("permission") }),
      expect.objectContaining({ checkId: "github.secret_scanning", passed: false, title: "Secret scanning status is unavailable" }),
      expect.objectContaining({ checkId: "github.org_mfa", passed: false, title: "Organisation MFA status is unavailable" }),
    ]));
  });

  it("throws a precise unsupported error when repository metadata is inaccessible", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "server-secret");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));

    await expect(githubMonitorProvider.runChecks(connection))
      .rejects.toThrow("GitHub repository monitoring is unavailable with the granted scopes");
  });

  it("does not claim a 404 proves branch protection is absent", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "server-secret");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        default_branch: "main", security_and_analysis: { secret_scanning: { status: "enabled" } },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ two_factor_requirement_enabled: true }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchImpl);

    const checks = await githubMonitorProvider.runChecks(connection);

    expect(checks).toContainEqual(expect.objectContaining({
      checkId: "github.branch_protection",
      passed: false,
      title: "Branch protection is absent or unavailable",
      detail: expect.stringContaining("cannot distinguish"),
    }));
  });
});
