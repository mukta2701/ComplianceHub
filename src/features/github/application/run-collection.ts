import type { DiagnosticCode, GitHubFactSet, GitHubObservation } from "../domain/observation";
import { EXPECTED_GITHUB_CHECK_IDS } from "../domain/rules";
import { GitHubCollectionError } from "./collect-repository-facts";

export type CollectionRequest = {
  trigger: "initial" | "scheduled" | "manual" | "webhook";
  requestKey: string;
  installationId?: string;
  repositoryId?: string;
  signal?: AbortSignal;
};

export type CollectionTarget = {
  organisationId: string;
  installationId: string;
  repositoryId: string;
  providerInstallationId: number;
  providerRepositoryId: number;
  owner: string;
  name: string;
};

export type RunReservation = {
  runId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  attempt: number;
  acquisitionState: "acquired" | "reclaimed" | "active_duplicate" | "completed_duplicate";
  status: "running" | "succeeded" | "partial" | "failed" | "rate_limited";
  organisationId: string;
  installationId: string;
  repositoryId: string;
  providerRepositoryId: number;
};

export type RunResult = {
  status: "succeeded" | "partial" | "failed" | "rate_limited";
  diagnosticCode?: DiagnosticCode;
  observationCount: number;
  passedCount: number;
  failedCount: number;
  unknownCount: number;
  notApplicableCount: number;
  deriveCountsFromPersisted?: boolean;
};

export type CollectionDependencies = {
  listTargets(request: CollectionRequest): Promise<CollectionTarget[]>;
  reserveRun(target: CollectionTarget, request: CollectionRequest): Promise<RunReservation>;
  listPersistedObservationKeys(reservation: RunReservation, target: CollectionTarget): Promise<string[]>;
  collectFacts(target: CollectionTarget, signal?: AbortSignal): Promise<GitHubFactSet>;
  evaluate(facts: GitHubFactSet, context: { runId: string; observedAt: string }): GitHubObservation[];
  refreshRepository(target: CollectionTarget, facts: GitHubFactSet): Promise<void>;
  saveObservations(reservation: RunReservation, target: CollectionTarget, observations: GitHubObservation[]): Promise<number>;
  finaliseRun(reservation: RunReservation, target: CollectionTarget, result: RunResult): Promise<boolean>;
  now(): Date;
};

export type CollectionSummary = {
  installationsChecked: number;
  repositoriesChecked: number;
  observationsStored: number;
  repositoriesFailed: number;
  runsPartial: number;
};

export class GitHubCollectionTargetError extends Error {
  constructor() {
    super("GitHub collection targets are invalid");
    this.name = "GitHubCollectionTargetError";
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;
const repoName = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

function validateRequest(request: CollectionRequest): void {
  if (!(["initial", "scheduled", "manual", "webhook"] as const).includes(request.trigger)) {
    throw new GitHubCollectionTargetError();
  }
  if (request.requestKey.length < 1 || request.requestKey.length > 200) throw new GitHubCollectionTargetError();
  if (request.installationId && !uuid.test(request.installationId)) throw new GitHubCollectionTargetError();
  if (request.repositoryId && !uuid.test(request.repositoryId)) throw new GitHubCollectionTargetError();
}

function validateTargets(targets: CollectionTarget[], request: CollectionRequest): void {
  if (targets.length > 100) throw new GitHubCollectionTargetError();
  const localRepositories = new Set<string>();
  const providerRepositories = new Set<number>();
  const installationAncestry = new Map<string, string>();
  const providerInstallationAncestry = new Map<number, string>();

  for (const target of targets) {
    if (
      !uuid.test(target.organisationId)
      || !uuid.test(target.installationId)
      || !uuid.test(target.repositoryId)
      || !Number.isSafeInteger(target.providerInstallationId)
      || target.providerInstallationId <= 0
      || !Number.isSafeInteger(target.providerRepositoryId)
      || target.providerRepositoryId <= 0
      || !login.test(target.owner)
      || !repoName.test(target.name)
      || localRepositories.has(target.repositoryId)
      || providerRepositories.has(target.providerRepositoryId)
      || (request.installationId !== undefined && request.installationId !== target.installationId)
      || (request.repositoryId !== undefined && request.repositoryId !== target.repositoryId)
    ) throw new GitHubCollectionTargetError();

    const installationOwner = installationAncestry.get(target.installationId);
    const providerOwner = providerInstallationAncestry.get(target.providerInstallationId);
    if (
      (installationOwner !== undefined && installationOwner !== target.organisationId)
      || (providerOwner !== undefined && providerOwner !== `${target.organisationId}/${target.installationId}`)
    ) throw new GitHubCollectionTargetError();
    installationAncestry.set(target.installationId, target.organisationId);
    providerInstallationAncestry.set(target.providerInstallationId, `${target.organisationId}/${target.installationId}`);
    localRepositories.add(target.repositoryId);
    providerRepositories.add(target.providerRepositoryId);
  }
}

function groupByInstallation(targets: CollectionTarget[]): CollectionTarget[][] {
  const groups = new Map<string, CollectionTarget[]>();
  for (const target of targets) {
    const key = `${target.organisationId}/${target.installationId}/${target.providerInstallationId}`;
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function expectedObservationKeys(target: CollectionTarget): Set<string> {
  return new Set(EXPECTED_GITHUB_CHECK_IDS.map((checkId) => `${target.owner}/${target.name}/${checkId}/github-repository-v1`));
}

function isCompletePersistedSet(keys: string[], target: CollectionTarget): boolean {
  const expected = expectedObservationKeys(target);
  return keys.length === expected.size && new Set(keys).size === keys.length && keys.every((key) => expected.has(key));
}

function validateObservations(rows: GitHubObservation[], target: CollectionTarget, runId: string): void {
  const expected = new Set(EXPECTED_GITHUB_CHECK_IDS);
  const seen = new Set<string>();
  if (rows.length !== expected.size) throw new GitHubCollectionTargetError();
  for (const row of rows) {
    if (
      row.runId !== runId
      || row.repositoryId !== target.providerRepositoryId
      || row.subjectType !== "github_repository"
      || row.subjectId !== `${target.owner}/${target.name}`
      || row.sourceUrl !== `https://github.com/${target.owner}/${target.name}`
      || !expected.has(row.checkId as typeof EXPECTED_GITHUB_CHECK_IDS[number])
      || seen.has(row.checkId)
      || row.observationKey !== `${target.owner}/${target.name}/${row.checkId}/github-repository-v1`
    ) throw new GitHubCollectionTargetError();
    seen.add(row.checkId);
  }
}

function counts(rows: GitHubObservation[]): Omit<RunResult, "status"> {
  return {
    observationCount: rows.length,
    passedCount: rows.filter((row) => row.result === "pass").length,
    failedCount: rows.filter((row) => row.result === "fail").length,
    unknownCount: rows.filter((row) => row.result === "unknown").length,
    notApplicableCount: rows.filter((row) => row.result === "not_applicable").length,
  };
}

const emptyCounts = { observationCount: 0, passedCount: 0, failedCount: 0, unknownCount: 0, notApplicableCount: 0 };

async function finaliseOrThrow(deps: CollectionDependencies, reservation: RunReservation, target: CollectionTarget, result: RunResult): Promise<void> {
  if (!await deps.finaliseRun(reservation, target, result)) throw new GitHubCollectionTargetError();
}

export async function runGitHubCollection(deps: CollectionDependencies, request: CollectionRequest): Promise<CollectionSummary> {
  validateRequest(request);
  const targets = await deps.listTargets(request);
  validateTargets(targets, request);
  const groups = groupByInstallation(targets);
  const summary: CollectionSummary = { installationsChecked: groups.length, repositoriesChecked: 0, observationsStored: 0, repositoriesFailed: 0, runsPartial: 0 };

  for (const group of groups) {
    let installationRateLimited = false;
    for (const target of group) {
      if (installationRateLimited || request.signal?.aborted) {
        summary.repositoriesFailed += 1;
        continue;
      }

      let reservation: RunReservation | undefined;
      try {
        reservation = await deps.reserveRun(target, request);
        if (reservation.acquisitionState === "active_duplicate" || reservation.acquisitionState === "completed_duplicate") continue;
        summary.repositoriesChecked += 1;
        const persistedKeys = await deps.listPersistedObservationKeys(reservation, target);
        if (persistedKeys.length > 0) {
          if (!isCompletePersistedSet(persistedKeys, target)) {
            await finaliseOrThrow(deps, reservation, target, { status: "failed", diagnosticCode: "invalid_response", ...emptyCounts, observationCount: persistedKeys.length, deriveCountsFromPersisted: true });
            summary.repositoriesFailed += 1;
            continue;
          }
          await finaliseOrThrow(deps, reservation, target, { status: "succeeded", ...emptyCounts, observationCount: persistedKeys.length, deriveCountsFromPersisted: true });
          summary.observationsStored += persistedKeys.length;
          continue;
        }

        const collectedAt = deps.now();
        if (!Number.isFinite(collectedAt.getTime())) throw new GitHubCollectionTargetError();
        const facts = await deps.collectFacts(target, request.signal);
        if (
          facts.repository.id !== target.providerRepositoryId
          || facts.repository.owner !== target.owner
          || facts.repository.name !== target.name
        ) throw new GitHubCollectionTargetError();
        const rows = deps.evaluate(facts, { runId: reservation.runId, observedAt: collectedAt.toISOString() });
        validateObservations(rows, target, reservation.runId);
        await deps.refreshRepository(target, facts);
        const persistedCount = await deps.saveObservations(reservation, target, rows);
        if (persistedCount !== rows.length) throw new GitHubCollectionTargetError();
        const resultCounts = counts(rows);
        const status = resultCounts.unknownCount > 0 ? "partial" : "succeeded";
        await finaliseOrThrow(deps, reservation, target, { status, ...resultCounts });
        summary.observationsStored += persistedCount;
        if (status === "partial") summary.runsPartial += 1;
      } catch (error) {
        summary.repositoriesFailed += 1;
        const diagnosticCode: DiagnosticCode = error instanceof GitHubCollectionError ? error.diagnosticCode : "invalid_response";
        if (reservation) {
          try {
            await finaliseOrThrow(deps, reservation, target, {
              status: diagnosticCode === "rate_limited" ? "rate_limited" : "failed",
              diagnosticCode,
              ...emptyCounts,
              deriveCountsFromPersisted: true,
            });
          } catch { /* a lost lease is intentionally unable to mutate the run */ }
        }
        if (diagnosticCode === "rate_limited") installationRateLimited = true;
      }
    }
  }

  return summary;
}
