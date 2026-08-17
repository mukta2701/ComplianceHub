import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { GitHubFactSet, GitHubObservation } from "../domain/observation";
import { evaluateGitHubRepository, EXPECTED_GITHUB_CHECK_IDS } from "../domain/rules";
import {
  GitHubCollectionTargetError,
  runGitHubCollection,
  type CollectionDependencies,
  type CollectionTarget,
  type RunReservation,
} from "./run-collection";
import { GitHubCollectionError } from "./collect-repository-facts";

const observedAt = "2026-08-17T05:29:00.000Z";

function target(overrides: Partial<CollectionTarget> = {}): CollectionTarget {
  return {
    organisationId: "10000000-0000-4000-8000-000000000001",
    installationId: "20000000-0000-4000-8000-000000000001",
    repositoryId: "30000000-0000-4000-8000-000000000001",
    providerInstallationId: 77,
    providerRepositoryId: 101,
    owner: "adtecher",
    name: "portal",
    ...overrides,
  };
}

function reservation(item: CollectionTarget, overrides: Partial<RunReservation> = {}): RunReservation {
  return {
    runId: `40000000-0000-4000-8000-${String(item.providerRepositoryId).padStart(12, "0")}`,
    leaseToken: randomUUID(),
    leaseExpiresAt: "2026-08-17T05:31:00.000Z",
    attempt: 1,
    acquisitionState: "acquired",
    status: "running",
    organisationId: item.organisationId,
    installationId: item.installationId,
    repositoryId: item.repositoryId,
    providerRepositoryId: item.providerRepositoryId,
    ...overrides,
  };
}

function facts(item: CollectionTarget): GitHubFactSet {
  const available = <T,>(value: T) => ({ state: "available" as const, value });
  return {
    repository: { id: item.providerRepositoryId, owner: item.owner, name: item.name, visibility: "private", archived: false, defaultBranch: "main", url: `https://github.com/${item.owner}/${item.name}` },
    branchProtection: available({ forcePushesBlocked: true, deletionsBlocked: true, approvingReviews: 2, dismissesStaleReviews: true, codeOwnerReviews: true, requiredStatusChecks: ["test"] }),
    dependabot: available({ openHigh: 0, openCritical: 0 }),
    codeScanning: available({ openHigh: 0, openCritical: 0 }),
    secretScanningConfiguration: available({ enabled: true }),
    secretScanningPushProtection: available({ enabled: true }),
    secretScanningAlerts: available({ openAlerts: 0 }),
    securityWorkflows: available([{ id: 1, name: "CodeQL", approved: true, active: true, latestConclusion: "success" }]),
    administration: available({ outsideCollaboratorAdmins: 0 }),
  };
}

function observations(item: CollectionTarget, runId: string, result: GitHubObservation["result"] = "pass"): GitHubObservation[] {
  return EXPECTED_GITHUB_CHECK_IDS.map((checkId) => ({
    observationKey: `${item.owner}/${item.name}/${checkId}/github-repository-v1`,
    runId,
    repositoryId: item.providerRepositoryId,
    checkId,
    ruleVersion: "github-repository-v1",
    subjectType: "github_repository" as const,
    subjectId: `${item.owner}/${item.name}`,
    result,
    severity: result === "fail" ? "high" as const : null,
    title: checkId,
    explanation: "verified",
    remediation: result === "fail" ? "fix it" : null,
    observedAt,
    freshUntil: "2026-08-18T17:29:00.000Z",
    sourceUrl: `https://github.com/${item.owner}/${item.name}`,
    fingerprint: "a".repeat(64),
    diagnosticCode: result === "unknown" ? "permission_denied" as const : null,
  }));
}

function dependencies(items: CollectionTarget[]) {
  const reservations = new Map(items.map((item) => [item.repositoryId, reservation(item)]));
  const deps: CollectionDependencies = {
    listTargets: vi.fn().mockResolvedValue(items),
    reserveRun: vi.fn(async (item) => reservations.get(item.repositoryId)!),
    listPersistedObservationKeys: vi.fn().mockResolvedValue([]),
    collectFacts: vi.fn(async (item) => facts(item)),
    evaluate: vi.fn((input, context) => observations(items.find((item) => item.providerRepositoryId === input.repository.id)!, context.runId)),
    refreshRepository: vi.fn().mockResolvedValue(undefined),
    saveObservations: vi.fn(async (_lease, _item, rows) => rows.length),
    finaliseRun: vi.fn().mockResolvedValue(true),
    now: () => new Date(observedAt),
  };
  return deps;
}

describe("runGitHubCollection", () => {
  it("keeps the persisted expected check contract aligned with the evaluator", () => {
    expect(evaluateGitHubRepository(facts(target()), { runId: "run", observedAt }).map((row) => row.checkId)).toEqual([...EXPECTED_GITHUB_CHECK_IDS]);
  });

  it("stores the complete expected set and treats compliance failures as collected success", async () => {
    const item = target();
    const deps = dependencies([item]);
    vi.mocked(deps.evaluate).mockImplementation((_facts, context) => observations(item, context.runId, "fail"));

    const summary = await runGitHubCollection(deps, { trigger: "manual", requestKey: "manual:opaque" });

    expect(summary).toEqual({ installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15, repositoriesFailed: 0, runsPartial: 0 });
    expect(deps.finaliseRun).toHaveBeenCalledWith(expect.anything(), item, expect.objectContaining({ status: "succeeded", failedCount: 15 }));
  });

  it("marks unknown observations partial and continues after another repository fails", async () => {
    const first = target();
    const second = target({ repositoryId: "30000000-0000-4000-8000-000000000002", providerRepositoryId: 102, name: "api" });
    const deps = dependencies([first, second]);
    vi.mocked(deps.collectFacts).mockRejectedValueOnce(new GitHubCollectionError("provider_unavailable")).mockResolvedValueOnce(facts(second));
    vi.mocked(deps.evaluate).mockImplementation((_facts, context) => observations(second, context.runId, "unknown"));

    const summary = await runGitHubCollection(deps, { trigger: "scheduled", requestKey: "scheduled:2026-08-17" });

    expect(summary.repositoriesChecked).toBe(2);
    expect(summary.repositoriesFailed).toBe(1);
    expect(summary.runsPartial).toBe(1);
    expect(deps.finaliseRun).toHaveBeenCalledWith(expect.anything(), second, expect.objectContaining({ status: "partial", unknownCount: 15 }));
  });

  it("groups interleaved targets and skips only the rate-limited installation", async () => {
    const a1 = target();
    const b1 = target({ installationId: "20000000-0000-4000-8000-000000000002", repositoryId: "30000000-0000-4000-8000-000000000002", providerInstallationId: 88, providerRepositoryId: 201, name: "worker" });
    const a2 = target({ repositoryId: "30000000-0000-4000-8000-000000000003", providerRepositoryId: 102, name: "api" });
    const deps = dependencies([a1, b1, a2]);
    vi.mocked(deps.collectFacts).mockImplementation(async (item) => {
      if (item.repositoryId === a1.repositoryId) throw new GitHubCollectionError("rate_limited");
      return facts(item);
    });

    const summary = await runGitHubCollection(deps, { trigger: "scheduled", requestKey: "scheduled:2026-08-17" });

    expect(vi.mocked(deps.collectFacts).mock.calls.map(([item]) => item.repositoryId)).toEqual([a1.repositoryId, b1.repositoryId]);
    expect(summary.repositoriesFailed).toBe(2);
    expect(summary.observationsStored).toBe(15);
  });

  it("skips active/completed duplicates and reclaims empty stale work", async () => {
    const active = target();
    const complete = target({ repositoryId: "30000000-0000-4000-8000-000000000002", providerRepositoryId: 102, name: "api" });
    const stale = target({ repositoryId: "30000000-0000-4000-8000-000000000003", providerRepositoryId: 103, name: "worker" });
    const deps = dependencies([active, complete, stale]);
    vi.mocked(deps.reserveRun)
      .mockResolvedValueOnce(reservation(active, { acquisitionState: "active_duplicate" }))
      .mockResolvedValueOnce(reservation(complete, { acquisitionState: "completed_duplicate", status: "succeeded" }))
      .mockResolvedValueOnce(reservation(stale, { acquisitionState: "reclaimed", attempt: 2 }));

    const summary = await runGitHubCollection(deps, { trigger: "manual", requestKey: "manual:same" });

    expect(deps.collectFacts).toHaveBeenCalledTimes(1);
    expect(summary.repositoriesChecked).toBe(1);
  });

  it("finalises a reclaimed complete set without recollecting", async () => {
    const item = target();
    const deps = dependencies([item]);
    const lease = reservation(item, { acquisitionState: "reclaimed", attempt: 2 });
    vi.mocked(deps.reserveRun).mockResolvedValue(lease);
    vi.mocked(deps.listPersistedObservationKeys).mockResolvedValue(observations(item, lease.runId).map((row) => row.observationKey));

    const summary = await runGitHubCollection(deps, { trigger: "manual", requestKey: "manual:retry" });

    expect(deps.collectFacts).not.toHaveBeenCalled();
    expect(deps.finaliseRun).toHaveBeenCalledWith(lease, item, expect.objectContaining({ status: "succeeded", deriveCountsFromPersisted: true }));
    expect(summary.observationsStored).toBe(15);
  });

  it("fails safely for a partial or unexpected persisted set", async () => {
    const item = target();
    const deps = dependencies([item]);
    vi.mocked(deps.reserveRun).mockResolvedValue(reservation(item, { acquisitionState: "reclaimed", attempt: 2 }));
    vi.mocked(deps.listPersistedObservationKeys).mockResolvedValue(["unexpected"]);

    const summary = await runGitHubCollection(deps, { trigger: "manual", requestKey: "manual:retry" });

    expect(deps.collectFacts).not.toHaveBeenCalled();
    expect(deps.finaliseRun).toHaveBeenCalledWith(expect.anything(), item, expect.objectContaining({ status: "failed", diagnosticCode: "invalid_response" }));
    expect(summary.repositoriesFailed).toBe(1);
  });

  it("rejects malformed, cross-tenant, or duplicate targets before provider work", async () => {
    const first = target();
    const duplicateProvider = target({ organisationId: "10000000-0000-4000-8000-000000000002", installationId: "20000000-0000-4000-8000-000000000002", repositoryId: "30000000-0000-4000-8000-000000000002" });
    const deps = dependencies([first, duplicateProvider]);

    await expect(runGitHubCollection(deps, { trigger: "manual", requestKey: "manual:bad" })).rejects.toBeInstanceOf(GitHubCollectionTargetError);
    expect(deps.reserveRun).not.toHaveBeenCalled();
    expect(deps.collectFacts).not.toHaveBeenCalled();
  });

  it("requires lease-checked save and finalise success", async () => {
    const item = target();
    const deps = dependencies([item]);
    vi.mocked(deps.finaliseRun).mockResolvedValue(false);

    const summary = await runGitHubCollection(deps, { trigger: "manual", requestKey: "manual:lost-lease" });

    expect(summary.repositoriesFailed).toBe(1);
  });
});
