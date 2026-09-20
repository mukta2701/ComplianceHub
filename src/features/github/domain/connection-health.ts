export const GITHUB_CONNECTION_HEALTHS = [
  "healthy",
  "retrying",
  "partially_unavailable",
  "owner_action_required",
  "disconnected",
] as const;

export type GitHubConnectionHealth = (typeof GITHUB_CONNECTION_HEALTHS)[number];

export const GITHUB_CONNECTION_DIAGNOSTICS = [
  "provider_rate_limited",
  "provider_temporary_failure",
  "installation_suspended",
  "installation_revoked",
  "permission_mismatch",
  "account_mismatch",
  "repository_unavailable",
  "invalid_provider_response",
  "internal_failure",
] as const;

export type GitHubConnectionDiagnostic = (typeof GITHUB_CONNECTION_DIAGNOSTICS)[number];

export type ConnectionReconciliationOutcome =
  | "success"
  | "partial"
  | "temporary_failure"
  | "action_required"
  | "disconnected";

export type ConnectionReconciliationDecision = {
  health: GitHubConnectionHealth;
  retryAt: string | null;
  openIncident: boolean;
  closeIncident: boolean;
  diagnostic: GitHubConnectionDiagnostic | null;
};

const RETRY_DELAYS_MINUTES = [1, 5, 15];
const INCIDENT_FAILURE_THRESHOLD = 3;

function parseTimestamp(value: string, field: string): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(`GitHub connection decision requires a valid ${field}`);
  return time;
}

function retryAtIso(nowMs: number, failures: number, providerRetryAt?: string | null): string {
  const delayMinutes = RETRY_DELAYS_MINUTES[Math.min(failures, RETRY_DELAYS_MINUTES.length) - 1] ?? 15;
  let retryMs = nowMs + delayMinutes * 60_000;
  if (providerRetryAt !== undefined && providerRetryAt !== null) {
    const providerMs = parseTimestamp(providerRetryAt, "provider retry time");
    if (providerMs > retryMs) retryMs = providerMs;
  }
  return new Date(retryMs).toISOString();
}

export function decideConnectionReconciliation(input: {
  previousHealth: GitHubConnectionHealth;
  consecutiveFailures: number;
  outcome: ConnectionReconciliationOutcome;
  diagnostic: GitHubConnectionDiagnostic | null;
  now: string;
  providerRetryAt?: string | null;
}): ConnectionReconciliationDecision {
  const nowMs = parseTimestamp(input.now, "timestamp");
  const failures = Number.isSafeInteger(input.consecutiveFailures) && input.consecutiveFailures >= 0
    ? input.consecutiveFailures
    : 0;

  if (input.outcome === "success") {
    const recovering = input.previousHealth !== "healthy"
      && (input.previousHealth !== "retrying" || failures >= INCIDENT_FAILURE_THRESHOLD);
    return {
      health: "healthy",
      retryAt: null,
      openIncident: false,
      closeIncident: recovering,
      diagnostic: input.diagnostic,
    };
  }

  if (input.outcome === "temporary_failure") {
    const consecutive = failures + 1;
    return {
      health: "retrying",
      retryAt: retryAtIso(nowMs, consecutive, input.providerRetryAt),
      openIncident: consecutive >= INCIDENT_FAILURE_THRESHOLD,
      closeIncident: false,
      diagnostic: input.diagnostic,
    };
  }

  if (input.outcome === "partial") {
    return {
      health: "partially_unavailable",
      retryAt: null,
      openIncident: true,
      closeIncident: false,
      diagnostic: input.diagnostic,
    };
  }

  if (input.outcome === "action_required") {
    return {
      health: "owner_action_required",
      retryAt: null,
      openIncident: true,
      closeIncident: false,
      diagnostic: input.diagnostic,
    };
  }

  return {
    health: "disconnected",
    retryAt: null,
    openIncident: true,
    closeIncident: false,
    diagnostic: input.diagnostic,
  };
}
