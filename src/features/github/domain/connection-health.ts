export type GitHubConnectionHealth =
  | "healthy"
  | "retrying"
  | "partially_unavailable"
  | "owner_action_required"
  | "disconnected";

export type GitHubConnectionDiagnostic =
  | "provider_rate_limited"
  | "provider_temporary_failure"
  | "installation_suspended"
  | "installation_revoked"
  | "permission_mismatch"
  | "account_mismatch"
  | "repository_unavailable"
  | "invalid_provider_response"
  | "internal_failure";

export type ConnectionReconciliationDecision = {
  health: GitHubConnectionHealth;
  retryAt: string | null;
  openIncident: boolean;
  closeIncident: boolean;
  diagnostic: GitHubConnectionDiagnostic | null;
};

type ReconciliationOutcome =
  | "success"
  | "partial"
  | "temporary_failure"
  | "action_required"
  | "disconnected";

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`expected a valid ${label}`);
  return parsed;
}

export function decideConnectionReconciliation(input: {
  previousHealth: GitHubConnectionHealth;
  consecutiveFailures: number;
  outcome: ReconciliationOutcome;
  diagnostic: GitHubConnectionDiagnostic | null;
  now: string;
  providerRetryAt?: string | null;
}): ConnectionReconciliationDecision {
  const now = parseTime(input.now, "reconciliation time");
  if (!Number.isInteger(input.consecutiveFailures) || input.consecutiveFailures < 0) {
    throw new TypeError("expected a non-negative integer failure count");
  }
  if (input.outcome === "success" && input.diagnostic !== null) {
    throw new TypeError("successful reconciliation cannot carry a diagnostic");
  }
  if (input.outcome !== "success" && input.diagnostic === null) {
    throw new TypeError("unavailable reconciliation must carry a diagnostic");
  }

  const diagnosticsByOutcome = {
    partial: ["repository_unavailable"],
    temporary_failure: [
      "provider_rate_limited",
      "provider_temporary_failure",
      "invalid_provider_response",
      "internal_failure",
    ],
    action_required: [
      "installation_suspended",
      "permission_mismatch",
      "account_mismatch",
    ],
    disconnected: ["installation_revoked"],
  } satisfies Record<Exclude<ReconciliationOutcome, "success">, GitHubConnectionDiagnostic[]>;
  if (
    input.outcome !== "success"
    && !(diagnosticsByOutcome[input.outcome] as readonly GitHubConnectionDiagnostic[])
      .includes(input.diagnostic as GitHubConnectionDiagnostic)
  ) {
    throw new TypeError("diagnostic does not match outcome");
  }

  const previousIncidentOpen = input.previousHealth === "partially_unavailable"
    || input.previousHealth === "owner_action_required"
    || input.previousHealth === "disconnected"
    || (input.previousHealth === "retrying" && input.consecutiveFailures >= 3);

  if (input.outcome === "success") {
    return {
      health: "healthy",
      retryAt: null,
      openIncident: false,
      closeIncident: previousIncidentOpen,
      diagnostic: null,
    };
  }

  if (input.outcome === "temporary_failure") {
    const retryDelays = [60_000, 5 * 60_000, 15 * 60_000] as const;
    const delay = retryDelays[Math.min(input.consecutiveFailures, retryDelays.length - 1)];
    let retryAt = now + delay;
    if (
      input.diagnostic === "provider_rate_limited"
      && input.providerRetryAt !== undefined
      && input.providerRetryAt !== null
    ) {
      retryAt = Math.max(retryAt, parseTime(input.providerRetryAt, "provider retry time"));
    }
    return {
      health: "retrying",
      retryAt: new Date(retryAt).toISOString(),
      openIncident: previousIncidentOpen || input.consecutiveFailures + 1 >= 3,
      closeIncident: false,
      diagnostic: input.diagnostic,
    };
  }

  return {
    health: input.outcome === "partial"
      ? "partially_unavailable"
      : input.outcome === "action_required"
        ? "owner_action_required"
        : "disconnected",
    retryAt: null,
    openIncident: true,
    closeIncident: false,
    diagnostic: input.diagnostic,
  };
}
