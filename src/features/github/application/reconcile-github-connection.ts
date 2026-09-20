import "server-only";

import { hasExactReadPermissions } from "./github-app-auth";
import {
  decideConnectionReconciliation,
  type ConnectionReconciliationDecision,
  type GitHubConnectionDiagnostic,
  type GitHubConnectionHealth,
} from "../domain/connection-health";
import {
  type InstallationSnapshot,
} from "./github-installation-api";
import type { UserInstallationRepository } from "./github-user-oauth";

export type ClaimedGitHubConnectionReconciliation = {
  runId: string;
  installationUuid: string;
  providerInstallationId: number;
  organisationId: string;
  previousHealth: GitHubConnectionHealth;
  consecutiveFailures: number;
  expectedAccount: { id: number; login: string; type: "Organization" | "User" };
};

export type StoredRepositoryIdentity = {
  providerId: number;
  fullName: string;
};

export type FinalizeConnectionInput = {
  runId: string;
  outcome: "success" | "partial" | "temporary_failure" | "action_required" | "disconnected";
  diagnostic: GitHubConnectionDiagnostic | null;
  nextAttemptAt: string | null;
  snapshot: UserInstallationRepository[] | null;
};

export type ReconcileGitHubConnectionDependencies = {
  readSnapshot: (input: {
    installationId: number;
    appJwt: string;
    installationToken?: string;
    provideInstallationToken?: () => Promise<string>;
  }) => Promise<InstallationSnapshot>;
  provideCredentials: () => Promise<{
    appJwt: string;
    installationToken?: string;
    provideInstallationToken?: () => Promise<string>;
  }>;
  loadStoredRepositories: (installationUuid: string) => Promise<StoredRepositoryIdentity[]>;
  finalize: (input: FinalizeConnectionInput) => Promise<unknown>;
  now?: Date;
};

export type GitHubConnectionReconciliationResult = {
  decision: ConnectionReconciliationDecision;
  repositoriesSeen: number;
};

const API_ERROR_KINDS = [
  "unauthorized", "forbidden", "not_found", "rate_limited", "server", "network", "invalid",
] as const;

type ApiErrorKind = (typeof API_ERROR_KINDS)[number];

function apiErrorKind(error: unknown): ApiErrorKind | null {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" && (API_ERROR_KINDS as readonly string[]).includes(kind)
    ? (kind as ApiErrorKind)
    : null;
}

function apiRetryAt(error: unknown, now: Date): string | null {
  const retryAt = (error as { retryAt?: unknown } | null)?.retryAt;
  if (typeof retryAt === "string" && Number.isFinite(new Date(retryAt).getTime())) return retryAt;
  const resetAtEpochSeconds = (error as { resetAtEpochSeconds?: unknown } | null)?.resetAtEpochSeconds;
  if (Number.isSafeInteger(resetAtEpochSeconds) && (resetAtEpochSeconds as number) >= 0) {
    const resetAt = new Date((resetAtEpochSeconds as number) * 1_000);
    if (Number.isFinite(resetAt.getTime())) return resetAt.toISOString();
  }
  const retryAfterSeconds = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  if (Number.isSafeInteger(retryAfterSeconds)
    && (retryAfterSeconds as number) >= 0
    && (retryAfterSeconds as number) <= 86_400) {
    return new Date(now.getTime() + (retryAfterSeconds as number) * 1_000).toISOString();
  }
  return null;
}

function decideFromApiError(
  error: unknown,
  previousHealth: GitHubConnectionHealth,
  consecutiveFailures: number,
  now: Date,
): { outcome: FinalizeConnectionInput["outcome"]; diagnostic: GitHubConnectionDiagnostic; retryAt: string | null } {
  const kind = apiErrorKind(error);
  if (kind === null) {
    return { outcome: "temporary_failure", diagnostic: "internal_failure", retryAt: null };
  }
  if (kind === "rate_limited") {
    const decision = decideConnectionReconciliation({
      previousHealth, consecutiveFailures, outcome: "temporary_failure",
      diagnostic: "provider_rate_limited", now: now.toISOString(), providerRetryAt: apiRetryAt(error, now),
    });
    return { outcome: "temporary_failure", diagnostic: "provider_rate_limited", retryAt: decision.retryAt };
  }
  if (kind === "not_found") {
    return { outcome: "disconnected", diagnostic: "installation_revoked", retryAt: null };
  }
  if (kind === "unauthorized" || kind === "forbidden") {
    return { outcome: "action_required", diagnostic: "permission_mismatch", retryAt: null };
  }
  if (kind === "server" || kind === "network") {
    return { outcome: "temporary_failure", diagnostic: "provider_temporary_failure", retryAt: null };
  }
  return { outcome: "temporary_failure", diagnostic: "invalid_provider_response", retryAt: null };
}

export async function reconcileGitHubConnection(
  deps: ReconcileGitHubConnectionDependencies,
  claim: ClaimedGitHubConnectionReconciliation,
): Promise<GitHubConnectionReconciliationResult> {
  const now = deps.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("GitHub reconciliation requires a valid timestamp");

  let snapshot: InstallationSnapshot;
  try {
    const credentials = await deps.provideCredentials();
    snapshot = await deps.readSnapshot({
      installationId: claim.providerInstallationId,
      appJwt: credentials.appJwt,
      installationToken: credentials.installationToken,
      provideInstallationToken: credentials.provideInstallationToken,
    });
  } catch (error) {
    const mapped = decideFromApiError(error, claim.previousHealth, claim.consecutiveFailures, now);
    const decision = decideConnectionReconciliation({
      previousHealth: claim.previousHealth,
      consecutiveFailures: claim.consecutiveFailures,
      outcome: mapped.outcome,
      diagnostic: mapped.diagnostic,
      now: now.toISOString(),
      providerRetryAt: mapped.retryAt,
    });
    await deps.finalize({
      runId: claim.runId,
      outcome: mapped.outcome,
      diagnostic: mapped.diagnostic,
      nextAttemptAt: decision.retryAt,
      snapshot: null,
    });
    return { decision, repositoriesSeen: 0 };
  }

  if (snapshot.installationId !== claim.providerInstallationId) {
    throw new Error("GitHub reconciliation received a mismatched installation snapshot");
  }

  const accountMatches = snapshot.account.id === claim.expectedAccount.id
    && snapshot.account.type === claim.expectedAccount.type
    && snapshot.account.login.toLowerCase() === claim.expectedAccount.login.toLowerCase();
  if (!accountMatches) {
    return finalizeAccessDecision(deps, claim, now, "account_mismatch");
  }
  if (snapshot.repositorySelection !== "selected" || !hasExactReadPermissions(snapshot.permissions)) {
    return finalizeAccessDecision(deps, claim, now, "permission_mismatch");
  }
  if (snapshot.suspendedAt !== null) {
    return finalizeAccessDecision(deps, claim, now, "installation_suspended");
  }

  const stored = await deps.loadStoredRepositories(claim.installationUuid);
  const storedIds = new Set(stored.map((repository) => repository.providerId));
  const snapshotIds = new Set(snapshot.repositories.map((repository) => repository.id));
  const removed = [...storedIds].filter((id) => !snapshotIds.has(id));
  const outcome = removed.length > 0 ? "partial" : "success";
  const diagnostic = removed.length > 0 ? "repository_unavailable" : null;
  const decision = decideConnectionReconciliation({
    previousHealth: claim.previousHealth,
    consecutiveFailures: claim.consecutiveFailures,
    outcome,
    diagnostic,
    now: now.toISOString(),
  });
  await deps.finalize({
    runId: claim.runId,
    outcome,
    diagnostic,
    nextAttemptAt: decision.retryAt,
    snapshot: snapshot.repositories,
  });
  return { decision, repositoriesSeen: snapshot.repositories.length };
}

async function finalizeAccessDecision(
  deps: ReconcileGitHubConnectionDependencies,
  claim: ClaimedGitHubConnectionReconciliation,
  now: Date,
  diagnostic: GitHubConnectionDiagnostic,
): Promise<GitHubConnectionReconciliationResult> {
  const decision = decideConnectionReconciliation({
    previousHealth: claim.previousHealth,
    consecutiveFailures: claim.consecutiveFailures,
    outcome: "action_required",
    diagnostic,
    now: now.toISOString(),
  });
  await deps.finalize({
    runId: claim.runId,
    outcome: "action_required",
    diagnostic,
    nextAttemptAt: decision.retryAt,
    snapshot: null,
  });
  return { decision, repositoriesSeen: 0 };
}
