import { describe, expect, it } from "vitest";
import {
  evaluateGitHubRepository,
  EXPECTED_GITHUB_CHECK_IDS,
  RULE_PACK_VERSION,
} from "./rules";
import type { GitHubFactSet } from "./observation";

const complete: GitHubFactSet = {
  repository: {
    id: 101,
    owner: "adtecher",
    name: "portal",
    visibility: "private",
    archived: false,
    defaultBranch: "main",
    url: "https://github.com/adtecher/portal",
  },
  branchProtection: {
    state: "available",
    value: {
      forcePushesBlocked: true,
      deletionsBlocked: true,
      approvingReviews: 2,
      dismissesStaleReviews: true,
      codeOwnerReviews: true,
      requiredStatusChecks: ["test"],
    },
  },
  dependabot: { state: "available", value: { openHigh: 0, openCritical: 0 } },
  codeScanning: { state: "available", value: { openHigh: 0, openCritical: 0 } },
  secretScanningConfiguration: { state: "available", value: { enabled: true } },
  secretScanningPushProtection: { state: "available", value: { enabled: true } },
  secretScanningAlerts: { state: "available", value: { openAlerts: 0 } },
  securityWorkflows: {
    state: "available",
    value: [{ name: "CodeQL", approved: true, active: true, latestConclusion: "success" }],
  },
  administration: { state: "available", value: { outsideCollaboratorAdmins: 0 } },
};

const context = { runId: "run-1", observedAt: "2026-08-17T12:00:00.000Z" };

describe("evaluateGitHubRepository", () => {
  it("emits stable versioned passing observations", () => {
    const first = evaluateGitHubRepository(complete, context);
    const second = evaluateGitHubRepository(complete, {
      runId: "run-2",
      observedAt: "2026-08-17T13:00:00.000Z",
    });

    expect(first.find((item) => item.checkId === "github.branch.force_pushes")?.result).toBe("pass");
    expect(first.map((item) => item.observationKey)).toEqual(second.map((item) => item.observationKey));
    expect(RULE_PACK_VERSION).toBe("github-repository-v1");
    expect(first.every((item) => item.ruleVersion === "github-repository-v1")).toBe(true);
    expect(first.every((item) => item.ruleVersion === RULE_PACK_VERSION)).toBe(true);
    expect(first.map((item) => item.checkId)).toEqual(EXPECTED_GITHUB_CHECK_IDS);
  });

  it("normalizes the observation timestamp to UTC and sets freshness 36 hours later", () => {
    const observations = evaluateGitHubRepository(complete, {
      runId: "run-offset",
      observedAt: "2026-08-17T13:00:00+01:00",
    });

    expect(observations[0]?.observedAt).toBe("2026-08-17T12:00:00.000Z");
    expect(observations[0]?.freshUntil).toBe("2026-08-19T00:00:00.000Z");
  });

  it("rejects an invalid observation timestamp before evaluating rules", () => {
    expect(() =>
      evaluateGitHubRepository(complete, {
        runId: "run-invalid",
        observedAt: "not-a-timestamp",
      }),
    ).toThrowError("observedAt must be a valid ISO 8601 timestamp");
  });

  it.each([
    { timestamp: "August 17, 2026 12:00:00" },
    { timestamp: "2026-08-17 12:00:00" },
    { timestamp: "2026-08-17T12:00:00" },
  ])("rejects non-ISO or offset-free observation timestamp $timestamp", ({ timestamp }) => {
    expect(() =>
      evaluateGitHubRepository(complete, {
        runId: "run-non-iso",
        observedAt: timestamp,
      }),
    ).toThrowError("observedAt must be a valid ISO 8601 timestamp");
  });

  it.each([
    { approved: true, result: "pass" },
    { approved: false, result: "fail" },
  ])("returns $result when a successful active security workflow has approved=$approved", ({ approved, result }) => {
    const observations = evaluateGitHubRepository(
      {
        ...complete,
        securityWorkflows: {
          state: "available",
          value: [{ name: "Security workflow", approved, active: true, latestConclusion: "success" }],
        },
      },
      context,
    );

    expect(observations.find((item) => item.checkId === "github.workflow.security")?.result).toBe(result);
  });

  it.each([
    {
      name: "a disabled force-push block",
      facts: {
        ...complete,
        branchProtection: {
          state: "available" as const,
          value: {
            forcePushesBlocked: false,
            deletionsBlocked: true,
            approvingReviews: 2,
            dismissesStaleReviews: true,
            codeOwnerReviews: true,
            requiredStatusChecks: ["test"],
          },
        },
      },
      checkId: "github.branch.force_pushes",
      result: "fail",
    },
    {
      name: "denied Dependabot data",
      facts: {
        ...complete,
        dependabot: { state: "unavailable" as const, diagnosticCode: "permission_denied" as const },
      },
      checkId: "github.dependabot.high_critical",
      result: "unknown",
    },
    {
      name: "an archived repository runtime control",
      facts: {
        ...complete,
        repository: { ...complete.repository, archived: true },
      },
      checkId: "github.workflow.security",
      result: "not_applicable",
    },
  ])("returns $result for $name", ({ facts, checkId, result }) => {
    const observations = evaluateGitHubRepository(facts, context);

    expect(observations.find((item) => item.checkId === checkId)?.result).toBe(result);
  });

  it("does not let an unavailable secret-alert list hide known-disabled configuration", () => {
    const observations = evaluateGitHubRepository({
      ...complete,
      secretScanningConfiguration: { state: "available", value: { enabled: false } },
      secretScanningAlerts: { state: "unavailable", diagnosticCode: "feature_unavailable" },
    }, context);

    expect(observations.find((item) => item.checkId === "github.secret_scanning.enabled")?.result).toBe("fail");
    expect(observations.find((item) => item.checkId === "github.secret_scanning.open_alerts")?.result).toBe("unknown");
  });
});
