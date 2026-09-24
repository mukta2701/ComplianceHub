import { describe, expect, it, vi } from "vitest";

import {
  processGitHubComplianceResultAlerts,
  type GitHubComplianceResultAlertCandidate,
} from "./github-compliance-result-alert-workflow";

const organisationId = "10000000-0000-4000-8000-000000000001";
const repositoryId = "10000000-0000-4000-8000-000000000002";
const collectionRunId = "20000000-0000-4000-8000-000000000001";
const failureId = "10000000-0000-4000-8000-000000000003";
const appOrigin = "https://dev.compliancehub.example";
const evaluatedAt = "2026-09-24T10:01:00.000Z";

function candidate(
  overrides: Partial<GitHubComplianceResultAlertCandidate> = {},
): GitHubComplianceResultAlertCandidate {
  return {
    collectionRunId,
    organisationId,
    repositoryId,
    repositorySlug: "acme/isms",
    checkId: "github.branch.force_pushes",
    result: {
      id: failureId,
      outcome: "fail",
      observedAt: "2026-09-24T10:00:00.000Z",
      freshUntil: "2026-09-25T22:00:00.000Z",
      findingId: "10000000-0000-4000-8000-000000000004",
      evidenceId: null,
      severity: "high",
    },
    state: {
      revision: null,
      currentResultId: null,
      currentOutcome: null,
      actionableUnknownSince: null,
      activeIncident: null,
    },
    ...overrides,
  };
}

function ports(candidates: unknown[]) {
  return {
    loadCandidates: vi.fn().mockResolvedValue({ candidates, hasMore: false }),
    saveDecisions: vi.fn().mockResolvedValue({
      processed: candidates.length,
      conflicts: 0,
      eventsCreated: candidates.length,
      notificationsCreated: candidates.length * 2,
    }),
  };
}

describe("processGitHubComplianceResultAlerts", () => {
  it("persists a new failure incident and owner/admin notice using the existing rule builder", async () => {
    const deps = ports([candidate()]);

    const result = await processGitHubComplianceResultAlerts(deps, {
      evaluatedAt,
      appOrigin,
      scope: { collectionRunId, organisationId },
    });

    expect(deps.loadCandidates).toHaveBeenCalledWith({
      evaluatedAt,
      collectionRunId,
      organisationId,
      limit: 100,
    });
    expect(deps.saveDecisions).toHaveBeenCalledOnce();
    const saved = deps.saveDecisions.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({
      expectedRevision: null,
      currentResultId: failureId,
      nextActiveIncident: {
        kind: "failure",
        incidentKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        startedAt: "2026-09-24T10:00:00.000Z",
      },
      event: {
        kind: "failure",
        resultId: failureId,
        recordUrl: `${appOrigin}/app/monitoring?finding=10000000-0000-4000-8000-000000000004#finding-10000000-0000-4000-8000-000000000004`,
        notificationMessage: expect.stringContaining("Repository: acme/isms"),
      },
    });
    expect(result).toEqual({ candidates: 1, eventsCreated: 1, notificationsCreated: 2, conflicts: 0 });
  });

  it("records a verified recovery and clears only the matching active incident", async () => {
    const incidentKey = "a".repeat(64);
    const deps = ports([candidate({
      result: {
        id: "10000000-0000-4000-8000-000000000005",
        outcome: "pass",
        observedAt: "2026-09-24T12:00:00.000Z",
        freshUntil: "2026-09-26T00:00:00.000Z",
        findingId: null,
        evidenceId: "10000000-0000-4000-8000-000000000006",
        severity: null,
      },
      state: {
        revision: 4,
        currentResultId: "10000000-0000-4000-8000-000000000007",
        currentOutcome: "fail",
        actionableUnknownSince: null,
        activeIncident: { kind: "failure", incidentKey, startedAt: "2026-09-24T10:00:00.000Z" },
      },
    })]);

    await processGitHubComplianceResultAlerts(deps, {
      evaluatedAt: "2026-09-24T12:01:00.000Z",
      appOrigin,
      scope: { due: true },
    });

    const saved = deps.saveDecisions.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({
      expectedRevision: 4,
      nextActiveIncident: null,
      event: {
        kind: "recovery",
        incidentKey,
        resultId: "10000000-0000-4000-8000-000000000005",
      },
    });
  });

  it("uses the persisted first Unknown time and exact result link when the 36-hour threshold is due", async () => {
    const resultId = "10000000-0000-4000-8000-000000000008";
    const deps = ports([candidate({
      result: {
        id: resultId,
        outcome: "unknown",
        observedAt: "2026-09-24T08:00:00.000Z",
        freshUntil: "2026-09-26T08:00:00.000Z",
        findingId: null,
        evidenceId: null,
        severity: null,
      },
      state: {
        revision: 2,
        currentResultId: resultId,
        currentOutcome: "unknown",
        actionableUnknownSince: "2026-09-23T10:00:00.000Z",
        activeIncident: null,
      },
    })]);

    await processGitHubComplianceResultAlerts(deps, {
      evaluatedAt: "2026-09-24T22:00:00.000Z",
      appOrigin,
      scope: { due: true },
    });

    const saved = deps.saveDecisions.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({
      actionableUnknownSince: "2026-09-23T10:00:00.000Z",
      nextActiveIncident: {
        kind: "sustained_unknown",
        startedAt: "2026-09-23T10:00:00.000Z",
      },
      event: {
        kind: "sustained_unknown",
        recordUrl: `${appOrigin}/app/monitoring/github-results/${resultId}`,
      },
    });
  });

  it("notifies for a stale saved Pass from the due-state path without a new collection", async () => {
    const resultId = "10000000-0000-4000-8000-000000000009";
    const evidenceId = "10000000-0000-4000-8000-000000000010";
    const deps = ports([candidate({
      result: {
        id: resultId,
        outcome: "pass",
        observedAt: "2026-09-23T10:00:00.000Z",
        freshUntil: "2026-09-24T10:00:00.000Z",
        findingId: null,
        evidenceId,
        severity: null,
      },
      state: {
        revision: 3,
        currentResultId: resultId,
        currentOutcome: "pass",
        actionableUnknownSince: null,
        activeIncident: null,
      },
    })]);

    await processGitHubComplianceResultAlerts(deps, {
      evaluatedAt: "2026-09-24T10:00:00.000Z",
      appOrigin,
      scope: { due: true },
    });

    const saved = deps.saveDecisions.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({
      nextActiveIncident: { kind: "stale" },
      nextEvaluationAt: null,
      event: { kind: "stale", resultId },
    });
  });

  it("stores a suppressed unchanged Pass without creating an event", async () => {
    const resultId = "10000000-0000-4000-8000-000000000011";
    const deps = ports([candidate({
      result: {
        id: resultId,
        outcome: "pass",
        observedAt: "2026-09-24T10:00:00.000Z",
        freshUntil: "2026-09-25T22:00:00.000Z",
        findingId: null,
        evidenceId: "10000000-0000-4000-8000-000000000012",
        severity: null,
      },
      state: {
        revision: 5,
        currentResultId: resultId,
        currentOutcome: "pass",
        actionableUnknownSince: null,
        activeIncident: null,
      },
    })]);
    deps.saveDecisions.mockResolvedValue({ processed: 1, conflicts: 0, eventsCreated: 0, notificationsCreated: 0 });

    const summary = await processGitHubComplianceResultAlerts(deps, { evaluatedAt, appOrigin, scope: { due: true } });

    const saved = deps.saveDecisions.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({ event: null, nextEvaluationAt: "2026-09-25T22:00:00.000Z" });
    expect(summary.eventsCreated).toBe(0);
  });

  it("fails closed if the database returns another organization's result", async () => {
    const deps = ports([candidate({ organisationId: "20000000-0000-4000-8000-000000000001" })]);

    await expect(processGitHubComplianceResultAlerts(deps, {
      evaluatedAt,
      appOrigin,
      scope: {
        collectionRunId,
        organisationId,
      },
    }))
      .rejects.toThrow("GitHub compliance alert evaluation failed");
    expect(deps.saveDecisions).not.toHaveBeenCalled();
  });

  it("keyset-pages a large run without repeating candidates", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => candidate({
      repositoryId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      result: { ...candidate().result, id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` },
    }));
    const lastCandidate = candidate({
      repositoryId: "30000000-0000-4000-8000-000000000101",
      result: { ...candidate().result, id: "40000000-0000-4000-8000-000000000101" },
    });
    const loadCandidates = vi.fn()
      .mockResolvedValueOnce({ candidates: firstPage, hasMore: true })
      .mockResolvedValueOnce({ candidates: [lastCandidate], hasMore: false });
    const saveDecisions = vi.fn(async (decisions: unknown[]) => ({
      processed: decisions.length,
      conflicts: 0,
      eventsCreated: 0,
      notificationsCreated: 0,
    }));

    const summary = await processGitHubComplianceResultAlerts({ loadCandidates, saveDecisions }, {
      evaluatedAt,
      appOrigin,
      scope: { collectionRunId, organisationId },
    });

    expect(loadCandidates).toHaveBeenCalledTimes(2);
    expect(loadCandidates.mock.calls[1]![0]).toMatchObject({
      after: {
        organisationId,
        repositoryId: "30000000-0000-4000-8000-000000000100",
        checkId: "github.branch.force_pushes",
      },
    });
    expect(summary.candidates).toBe(101);
    expect(saveDecisions).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a later page repeats a prior candidate", async () => {
    const one = candidate({ repositoryId: "30000000-0000-4000-8000-000000000001" });
    const loadCandidates = vi.fn()
      .mockResolvedValueOnce({ candidates: [one], hasMore: true })
      .mockResolvedValueOnce({ candidates: [one], hasMore: false });
    const saveDecisions = vi.fn().mockResolvedValue({
      processed: 1,
      conflicts: 0,
      eventsCreated: 0,
      notificationsCreated: 0,
    });

    await expect(processGitHubComplianceResultAlerts({ loadCandidates, saveDecisions }, {
      evaluatedAt,
      appOrigin,
      scope: { collectionRunId, organisationId },
    })).rejects.toThrow("GitHub compliance alert evaluation failed");
    expect(saveDecisions).toHaveBeenCalledOnce();
  });

  it("accepts a legitimate notification count above 200 across a large workspace", async () => {
    const deps = ports([candidate()]);
    deps.saveDecisions.mockResolvedValue({
      processed: 1,
      conflicts: 0,
      eventsCreated: 1,
      notificationsCreated: 250,
    });

    const summary = await processGitHubComplianceResultAlerts(deps, {
      evaluatedAt,
      appOrigin,
      scope: { collectionRunId, organisationId },
    });

    expect(summary.notificationsCreated).toBe(250);
  });

  it("rejects an unsafe notification count from persistence", async () => {
    const deps = ports([candidate()]);
    deps.saveDecisions.mockResolvedValue({
      processed: 1,
      conflicts: 0,
      eventsCreated: 1,
      notificationsCreated: Number.MAX_SAFE_INTEGER + 1,
    });

    await expect(processGitHubComplianceResultAlerts(deps, {
      evaluatedAt,
      appOrigin,
      scope: { collectionRunId, organisationId },
    })).rejects.toThrow("GitHub compliance alert evaluation failed");
  });
});
