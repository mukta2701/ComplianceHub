import "server-only";

import { GitHubInstallationTokenError, hasExactReadPermissions } from "./github-app-auth";
import { GitHubRateLimitError } from "./github-collection-error";
import type {
  ClaimedGitHubConnectionReconciliation,
  GitHubConnectionFinalization,
  GitHubConnectionIncidentTransition,
  GitHubConnectionReconciliationOutcome,
} from "./github-connection-store";
import {
  GitHubInstallationApiError,
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
  }): Promise<InstallationCredential>;
  readSnapshot(input: {
    installationId: number;
    appJwt: string;
    installationToken: string;
  }): Promise<InstallationSnapshot>;
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

function safeRateLimitTime(error: GitHubRateLimitError, now: Date): string | null {
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
  if (error instanceof GitHubRateLimitError) {
    return {
      outcome: "temporary_failure",
      diagnostic: "provider_rate_limited",
      providerRetryAt: safeRateLimitTime(error, now),
    };
  }
  return { outcome: "temporary_failure", diagnostic: "internal_failure" };
}

function classifySnapshot(
  claim: ClaimedGitHubConnectionReconciliation,
  snapshot: InstallationSnapshot,
): ClassifiedOutcome {
  if (snapshot.installationId !== claim.providerInstallationId) {
    return { outcome: "temporary_failure", diagnostic: "invalid_provider_response" };
  }
  if (snapshot.suspendedAt !== null) {
    return { outcome: "action_required", diagnostic: "installation_suspended" };
  }
  if (
    snapshot.repositorySelection !== "selected"
    || !hasExactReadPermissions(snapshot.permissions)
  ) {
    return { outcome: "action_required", diagnostic: "permission_mismatch" };
  }
  if (
    snapshot.account.id !== claim.account.id
    || snapshot.account.type !== claim.account.type
    || snapshot.account.login.toLowerCase() !== claim.account.login.toLowerCase()
  ) {
    return { outcome: "action_required", diagnostic: "account_mismatch" };
  }
  const availableIds = new Set(snapshot.repositories.map((repository) => repository.id));
  const selectedRepositoryUnavailable = claim.selectedRepositoryIds.some((id) => !availableIds.has(id));
  return {
    outcome: selectedRepositoryUnavailable ? "partial" : "success",
    diagnostic: selectedRepositoryUnavailable ? "repository_unavailable" : null,
    repositories: [...snapshot.repositories].sort((left, right) => left.id - right.id),
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

async function readProviderSnapshot(
  deps: ReconcileGitHubConnectionDependencies,
  claim: ClaimedGitHubConnectionReconciliation,
  now: Date,
): Promise<InstallationSnapshot> {
  const appJwt = await deps.createAppJwt();
  const installationCredential = await deps.createInstallationToken({
    installationId: claim.providerInstallationId,
    appJwt,
    now,
  });
  const expiresAt = Date.parse(installationCredential.expiresAt);
  if (
    !installationCredential.token
    || installationCredential.token.length > 2_000
    || !Number.isFinite(expiresAt)
    || expiresAt <= now.getTime()
    || expiresAt > now.getTime() + 60 * 60_000
  ) throw new Error("invalid installation credential");
  return deps.readSnapshot({
    installationId: claim.providerInstallationId,
    appJwt,
    installationToken: installationCredential.token,
  });
}

export async function reconcileGitHubConnection(
  deps: ReconcileGitHubConnectionDependencies,
  claim: ClaimedGitHubConnectionReconciliation,
): Promise<GitHubConnectionReconciliationResult> {
  const now = deps.now();
  let classified: ClassifiedOutcome;
  try {
    if (!Number.isFinite(now.getTime())) throw new Error("invalid reconciliation time");
    const snapshot = await readProviderSnapshot(deps, claim, now);
    classified = classifySnapshot(claim, snapshot);
  } catch (error) {
    classified = classifyError(error, now);
  }

  const finalization = toFinalization(claim, classified);
  const incidentTransition = await deps.finalize(claim, finalization);
  return { ...finalization, incidentTransition };
}
