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

function relativeTime(value: string | null, now: string): string | null {
  if (!value) return null;
  const checked = Date.parse(value);
  const current = Date.parse(now);
  if (!Number.isFinite(checked) || !Number.isFinite(current)) return null;
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
        nextAction: "Ask a workspace Owner to review the GitHub App installation.",
      };
    case "permission_mismatch":
      return {
        summary: "GitHub App permissions no longer match the approved read-only access.",
        nextAction: "Ask a workspace Owner to review the GitHub App permissions.",
      };
    case "account_mismatch":
      return {
        summary: "The connected GitHub account no longer matches this workspace.",
        nextAction: "Ask a workspace Owner to reconnect the approved GitHub organisation.",
      };
    default:
      return {
        summary: "GitHub access needs a workspace Owner to review it.",
        nextAction: "Ask a workspace Owner to review the GitHub connection.",
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
        nextAction: "A workspace Owner can reconnect when GitHub access is ready.",
        tone: "neutral",
        checkedAt,
      };
  }
}
