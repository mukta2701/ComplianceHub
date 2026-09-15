import type {
  GitHubConnectionDiagnostic,
  GitHubConnectionHealth,
} from "@/features/github/domain/connection-health";

export type GitHubConnectionPresentation = {
  label: "Healthy" | "Retrying" | "Partly unavailable" | "Owner action required" | "Disconnected";
  summary: string;
  nextAction: string | null;
  tone: "success" | "warning" | "danger" | "neutral";
  checkedAt: string | null;
};

type GitHubInstallationStatus = "active" | "suspended" | "revoked" | "needs_attention";
type GitHubConnectionFact = {
  health: GitHubConnectionHealth;
  diagnostic: GitHubConnectionDiagnostic | null;
};

const healthRank: Record<GitHubConnectionHealth, number> = {
  healthy: 0,
  retrying: 1,
  partially_unavailable: 2,
  owner_action_required: 3,
  disconnected: 4,
};

function diagnosticHealth(diagnostic: GitHubConnectionDiagnostic | null): GitHubConnectionHealth | null {
  switch (diagnostic) {
    case "provider_rate_limited":
    case "provider_temporary_failure":
    case "invalid_provider_response":
    case "internal_failure":
      return "retrying";
    case "repository_unavailable":
      return "partially_unavailable";
    case "installation_suspended":
    case "permission_mismatch":
    case "account_mismatch":
      return "owner_action_required";
    case "installation_revoked":
      return "disconnected";
    default:
      return null;
  }
}

function normaliseConnectionFact(fact: GitHubConnectionFact): GitHubConnectionFact {
  const impliedHealth = diagnosticHealth(fact.diagnostic);
  if (!impliedHealth || healthRank[fact.health] <= healthRank[impliedHealth]) {
    return { health: impliedHealth ?? fact.health, diagnostic: fact.diagnostic };
  }
  return { health: fact.health, diagnostic: null };
}

/** Resolves independently sourced connection facts without downgrading risk. */
export function resolveGitHubConnectionHealth(input: {
  installationStatus: GitHubInstallationStatus;
  installationPermissionsOk: boolean;
  summary: GitHubConnectionFact;
  incident: GitHubConnectionFact | null;
  rawPermissionMismatch: boolean;
}): GitHubConnectionFact {
  const facts: GitHubConnectionFact[] = [normaliseConnectionFact(input.summary)];
  if (input.incident) facts.push(normaliseConnectionFact(input.incident));
  if (!input.installationPermissionsOk) facts.push({ health: "owner_action_required", diagnostic: null });
  if (input.installationStatus === "needs_attention") facts.push({ health: "owner_action_required", diagnostic: null });
  if (input.rawPermissionMismatch) facts.push({ health: "owner_action_required", diagnostic: "permission_mismatch" });
  if (input.installationStatus === "suspended") facts.push({ health: "owner_action_required", diagnostic: "installation_suspended" });
  if (input.installationStatus === "revoked") facts.push({ health: "disconnected", diagnostic: "installation_revoked" });
  return facts.reduce((strongest, fact) => {
    const strongestRank = healthRank[strongest.health];
    const factRank = healthRank[fact.health];
    if (factRank > strongestRank) return fact;
    if (factRank < strongestRank) return strongest;
    if (fact.diagnostic && !strongest.diagnostic) return fact;
    if (!fact.diagnostic && strongest.diagnostic) return strongest;
    return fact;
  });
}

function relativeTime(value: string | null, now: string): string | null {
  if (!value) return null;
  const checked = Date.parse(value);
  const current = Date.parse(now);
  if (!Number.isFinite(checked) || !Number.isFinite(current)) return null;
  if (checked - current > 60_000) return null;
  const seconds = Math.max(0, Math.floor((current - checked) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function ownerAction(diagnostic: GitHubConnectionDiagnostic | null): Pick<GitHubConnectionPresentation, "summary" | "nextAction"> {
  switch (diagnostic) {
    case "installation_suspended":
      return {
        summary: "GitHub has suspended this App installation.",
        nextAction: "Review the GitHub App installation.",
      };
    case "permission_mismatch":
      return {
        summary: "GitHub App permissions no longer match the approved read-only access.",
        nextAction: "Review the GitHub App permissions.",
      };
    case "account_mismatch":
      return {
        summary: "The connected GitHub account no longer matches this workspace.",
        nextAction: "Reconnect the approved GitHub organisation.",
      };
    default:
      return {
        summary: "GitHub access needs a workspace Owner to review it.",
        nextAction: "Review the GitHub connection.",
      };
  }
}

export function presentGitHubConnectionHealth(input: {
  health: GitHubConnectionHealth;
  diagnostic: GitHubConnectionDiagnostic | null;
  lastSuccessfulReconciliationAt: string | null;
  now: string;
}): GitHubConnectionPresentation {
  const checkedAt = relativeTime(input.lastSuccessfulReconciliationAt, input.now);
  switch (input.health) {
    case "healthy":
      return {
        label: "Healthy",
        summary: checkedAt
          ? `GitHub is connected and was checked ${checkedAt}. No action is needed.`
          : "GitHub is connected. Reconciliation freshness is not available yet.",
        nextAction: null,
        tone: "success",
        checkedAt,
      };
    case "retrying":
      return {
        label: "Retrying",
        summary: "ComplianceHub cannot currently verify GitHub access. We are retrying automatically.",
        nextAction: null,
        tone: "warning",
        checkedAt,
      };
    case "partially_unavailable":
      return {
        label: "Partly unavailable",
        summary: "One or more repositories cannot be verified. Other available repositories may still be usable.",
        nextAction: null,
        tone: "warning",
        checkedAt,
      };
    case "owner_action_required": {
      const action = ownerAction(input.diagnostic);
      return { label: "Owner action required", tone: "danger", checkedAt, ...action };
    }
    case "disconnected":
      return {
        label: "Disconnected",
        summary: "ComplianceHub is disconnected from this GitHub installation.",
        nextAction: "Reconnect GitHub when access is ready.",
        tone: "neutral",
        checkedAt,
      };
  }
}
