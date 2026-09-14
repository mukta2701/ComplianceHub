import "server-only";

import { GitHubInstallationTokenError, hasExactReadPermissions } from "./github-app-auth";
import type {
  ClaimedGitHubConnectionReconciliation,
  GitHubConnectionFinalization,
  GitHubConnectionIncidentTransition,
  GitHubConnectionReconciliationOutcome,
} from "./github-connection-store";
import {
  GitHubInstallationApiError,
  type InstallationMetadata,
  type InstallationSnapshot,
} from "./github-installation-api";
import { decideConnectionReconciliation } from "../domain/connection-health";

export type { ClaimedGitHubConnectionReconciliation } from "./github-connection-store";

type InstallationCredential = { token: string; expiresAt: string };

export type ReconcileGitHubConnectionDependencies = {
  createAppJwt(): Promise<string>;
  createInstallationToken(input: {
    installationId: number;
    appJwt: string;
    now: Date;
    signal: AbortSignal;
  }): Promise<InstallationCredential>;
  readMetadata(input: {
    installationId: number;
    appJwt: string;
    signal: AbortSignal;
  }): Promise<InstallationMetadata>;
  readRepositories(input: {
    installationToken: string;
    accountLogin: string;
    signal: AbortSignal;
  }): Promise<InstallationSnapshot["repositories"]>;
  finalize(
    claim: ClaimedGitHubConnectionReconciliation,
    finalization: GitHubConnectionFinalization,
  ): Promise<GitHubConnectionIncidentTransition>;
  now(): Date;
};

export type GitHubConnectionReconciliationResult = GitHubConnectionFinalization & {
  incidentTransition: GitHubConnectionIncidentTransition;
};

type ClassifiedOutcome = {
  outcome: GitHubConnectionReconciliationOutcome;
  diagnostic: GitHubConnectionFinalization["diagnostic"];
  providerRetryAt?: string | null;
  repositories?: InstallationSnapshot["repositories"];
};

const SUCCESS_INTERVAL_MS = 24 * 60 * 60_000;
const RECONCILIATION_DEADLINE_MS = 4 * 60_000;

function reconciliationTimeout(): DOMException {
  return new DOMException("GitHub reconciliation deadline reached", "TimeoutError");
}

function safeRateLimitTime(error: GitHubInstallationTokenError, now: Date): string | null {
  const candidates: number[] = [];
  if (error.retryAfterSeconds !== undefined) {
    candidates.push(now.getTime() + error.retryAfterSeconds * 1_000);
  }
  if (error.resetAtEpochSeconds !== undefined) {
    candidates.push(error.resetAtEpochSeconds * 1_000);
  }
  const valid = candidates.filter((value) => (
    Number.isFinite(value)
    && value >= now.getTime()
    && value <= now.getTime() + 86_400_000
  ));
  return valid.length === 0 ? null : new Date(Math.max(...valid)).toISOString();
}

function classifyError(error: unknown, now: Date): ClassifiedOutcome {
  if (error instanceof GitHubInstallationTokenError) {
    switch (error.diagnosticCode) {
      case "authentication_failed":
        return { outcome: "action_required", diagnostic: "permission_mismatch" };
      case "not_found":
        return { outcome: "disconnected", diagnostic: "installation_revoked" };
      case "invalid_response":
        return { outcome: "temporary_failure", diagnostic: "invalid_provider_response" };
      case "rate_limited":
        return {
          outcome: "temporary_failure",
          diagnostic: "provider_rate_limited",
          providerRetryAt: safeRateLimitTime(error, now),
        };
      case "provider_failure":
      case "timeout":
        return { outcome: "temporary_failure", diagnostic: "provider_temporary_failure" };
    }
  }
  if (error instanceof GitHubInstallationApiError) {
    switch (error.diagnosticCode) {
      case "permission_mismatch":
      case "authentication_failed":
        return { outcome: "action_required", diagnostic: "permission_mismatch" };
      case "not_found":
        return { outcome: "disconnected", diagnostic: "installation_revoked" };
      case "rate_limited":
        return {
          outcome: "temporary_failure",
          diagnostic: "provider_rate_limited",
          providerRetryAt: error.retryAt,
        };
      case "timeout":
      case "provider_failure":
        return { outcome: "temporary_failure", diagnostic: "provider_temporary_failure" };
      case "invalid_response":
        return { outcome: "temporary_failure", diagnostic: "invalid_provider_response" };
    }
  }
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { outcome: "temporary_failure", diagnostic: "provider_temporary_failure" };
  }
  return { outcome: "temporary_failure", diagnostic: "internal_failure" };
}

function classifyMetadata(
  claim: ClaimedGitHubConnectionReconciliation,
  metadata: InstallationMetadata,
): ClassifiedOutcome | null {
  if (metadata.installationId !== claim.providerInstallationId) {
    return { outcome: "temporary_failure", diagnostic: "invalid_provider_response" };
  }
  if (metadata.suspendedAt !== null) {
    return { outcome: "action_required", diagnostic: "installation_suspended" };
  }
  if (
    metadata.repositorySelection !== "selected"
    || !hasExactReadPermissions(metadata.permissions)
  ) {
    return { outcome: "action_required", diagnostic: "permission_mismatch" };
  }
  if (
    metadata.account.id !== claim.account.id
    || metadata.account.type !== claim.account.type
    || metadata.account.login.toLowerCase() !== claim.account.login.toLowerCase()
  ) {
    return { outcome: "action_required", diagnostic: "account_mismatch" };
  }
  return null;
}

function classifyRepositories(
  claim: ClaimedGitHubConnectionReconciliation,
  repositories: InstallationSnapshot["repositories"],
): ClassifiedOutcome {
  const availableIds = new Set(repositories.map((repository) => repository.id));
  const selectedRepositoryUnavailable = claim.selectedRepositoryIds.some((id) => !availableIds.has(id));
  return {
    outcome: selectedRepositoryUnavailable ? "partial" : "success",
    diagnostic: selectedRepositoryUnavailable ? "repository_unavailable" : null,
    repositories: [...repositories].sort((left, right) => left.id - right.id),
  };
}

function toFinalization(
  claim: ClaimedGitHubConnectionReconciliation,
  classified: ClassifiedOutcome,
): GitHubConnectionFinalization {
  const decision = decideConnectionReconciliation({
    previousHealth: claim.previousHealth,
    consecutiveFailures: claim.consecutiveFailures,
    outcome: classified.outcome,
    diagnostic: classified.diagnostic,
    now: claim.attemptedAt,
    providerRetryAt: classified.providerRetryAt,
  });
  const nextAttemptAt = classified.outcome === "success" || classified.outcome === "partial"
    ? new Date(Date.parse(claim.attemptedAt) + SUCCESS_INTERVAL_MS).toISOString()
    : decision.retryAt;
  return {
    outcome: classified.outcome,
    diagnostic: classified.diagnostic,
    nextAttemptAt,
    repositorySnapshot: classified.outcome === "success" || classified.outcome === "partial"
      ? classified.repositories ?? []
      : [],
  };
}

async function readProviderState(
  deps: ReconcileGitHubConnectionDependencies,
  claim: ClaimedGitHubConnectionReconciliation,
  now: Date,
  signal: AbortSignal,
): Promise<ClassifiedOutcome> {
  const appJwt = await deps.createAppJwt();
  const metadata = await deps.readMetadata({
    installationId: claim.providerInstallationId,
    appJwt,
    signal,
  });
  const metadataOutcome = classifyMetadata(claim, metadata);
  if (metadataOutcome) return metadataOutcome;

  const installationCredential = await deps.createInstallationToken({
    installationId: claim.providerInstallationId,
    appJwt,
    now,
    signal,
  });
  const expiresAt = Date.parse(installationCredential.expiresAt);
  if (
    !installationCredential.token
    || installationCredential.token.length > 2_000
    || !Number.isFinite(expiresAt)
    || expiresAt <= now.getTime()
    || expiresAt > now.getTime() + 60 * 60_000
  ) throw new GitHubInstallationTokenError("invalid_response");
  const repositories = await deps.readRepositories({
    installationToken: installationCredential.token,
    accountLogin: metadata.account.login,
    signal,
  });
  return classifyRepositories(claim, repositories);
}

export async function reconcileGitHubConnection(
  deps: ReconcileGitHubConnectionDependencies,
  claim: ClaimedGitHubConnectionReconciliation,
): Promise<GitHubConnectionReconciliationResult> {
  const now = deps.now();
  const deadline = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let classified: ClassifiedOutcome;
  try {
    if (!Number.isFinite(now.getTime())) throw new Error("invalid reconciliation time");
    const deadlineAt = Date.parse(claim.attemptedAt) + RECONCILIATION_DEADLINE_MS;
    if (!Number.isFinite(deadlineAt)) throw new Error("invalid reconciliation deadline");
    const remainingMs = deadlineAt - now.getTime();
    if (remainingMs <= 0) throw reconciliationTimeout();
    deadlineTimer = setTimeout(() => {
      deadline.abort(reconciliationTimeout());
    }, remainingMs);
    classified = await readProviderState(deps, claim, now, deadline.signal);
  } catch (error) {
    classified = classifyError(error, now);
  } finally {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  }

  const finalization = toFinalization(claim, classified);
  const incidentTransition = await deps.finalize(claim, finalization);
  return { ...finalization, incidentTransition };
}
