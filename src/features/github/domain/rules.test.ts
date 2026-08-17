import { describe, expect, it } from "vitest";
import { evaluateGitHubRepository, RULE_PACK_VERSION } from "./rules";
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
  secretScanning: {
    state: "available",
    value: { enabled: true, pushProtectionEnabled: true, openAlerts: 0 },
  },
  securityWorkflows: {
    state: "available",
    value: [{ name: "CodeQL", active: true, latestConclusion: "success" }],
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
    expect(first.every((item) => item.ruleVersion === RULE_PACK_VERSION)).toBe(true);
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
});
