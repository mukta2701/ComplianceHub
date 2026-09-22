import type {
  GitHubConnectionDiagnostic,
  GitHubConnectionHealth,
} from "../domain/connection-health";
import { formatMonitoringTime } from "./format-monitoring-time";

export type GitHubConnectionPresentation = {
  label: "Healthy" | "Pending first check" | "Retrying" | "Partly unavailable" | "Owner action required" | "Disconnected";
  summary: string;
  nextAction: string | null;
  tone: "success" | "warning" | "danger" | "neutral";
  checkedAt: string | null;
};

const DIAGNOSTIC_PHRASE: Record<GitHubConnectionDiagnostic, string> = {
  provider_rate_limited: "GitHub rate-limited the last check",
  provider_temporary_failure: "GitHub had a temporary problem",
  installation_suspended: "the GitHub App installation is suspended",
  installation_revoked: "GitHub no longer reports this installation",
  permission_mismatch: "the App permission may have changed",
  account_mismatch: "the connected GitHub account does not match the approved one",
  repository_unavailable: "at least one repository is no longer visible to the App",
  invalid_provider_response: "GitHub returned an unexpected response",
  internal_failure: "an internal check failed",
};

function relativeCheckText(lastSuccessfulReconciliationAt: string, nowMs: number): string {
  const checkedMs = new Date(lastSuccessfulReconciliationAt).getTime();
  if (!Number.isFinite(checkedMs)) return "on an unknown date";
  const minutes = Math.floor((nowMs - checkedMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return formatMonitoringTime(lastSuccessfulReconciliationAt) ?? "on an unknown date";
}

export function presentGitHubConnectionHealth(input: {
  health: GitHubConnectionHealth;
  diagnostic: GitHubConnectionDiagnostic | null;
  lastSuccessfulReconciliationAt: string | null;
  now: string;
}): GitHubConnectionPresentation {
  const nowMs = new Date(input.now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("GitHub connection presentation requires a valid timestamp");
  const checkedAt = input.lastSuccessfulReconciliationAt
    ? (formatMonitoringTime(input.lastSuccessfulReconciliationAt) ?? null)
    : null;
  const when = input.lastSuccessfulReconciliationAt
    ? relativeCheckText(input.lastSuccessfulReconciliationAt, nowMs)
    : null;
  const cause = input.diagnostic ? DIAGNOSTIC_PHRASE[input.diagnostic] : null;

  if (input.health === "healthy" && !input.lastSuccessfulReconciliationAt) {
    return {
      label: "Pending first check",
      summary: "ComplianceHub has not verified this GitHub connection yet. Its health is unconfirmed.",
      nextAction: "An Owner must run the first GitHub check before ComplianceHub can confirm this connection.",
      tone: "neutral",
      checkedAt,
    };
  }

  if (input.health === "healthy") {
    return {
      label: "Healthy",
      summary: `GitHub is connected and the pilot repository was checked ${when ?? "recently"}. No action is needed.`,
      nextAction: null,
      tone: "success",
      checkedAt,
    };
  }

  if (input.health === "retrying") {
    return {
      label: "Retrying",
      summary: `ComplianceHub cannot currently verify GitHub access${cause ? ` (${cause[0]?.toLowerCase()}${cause.slice(1)})` : ""}. We are retrying automatically.`,
      nextAction: "Automatic retry is scheduled; check back after the next check.",
      tone: "warning",
      checkedAt,
    };
  }

  if (input.health === "partially_unavailable") {
    return {
      label: "Partly unavailable",
      summary: `Some connected repositories cannot currently be verified${cause ? ` (${cause})` : ""}. Verified repositories are unaffected.`,
      nextAction: "Review the unavailable repositories below, then re-check.",
      tone: "warning",
      checkedAt,
    };
  }

  if (input.health === "owner_action_required") {
    return {
      label: "Owner action required",
      summary: `ComplianceHub cannot currently verify GitHub access${cause ? ` (${cause})` : ""}. An Owner has been notified.`,
      nextAction: "An Owner needs to review the GitHub App installation before checks can resume.",
      tone: "danger",
      checkedAt,
    };
  }

  return {
    label: "Disconnected",
    summary: `This workspace is disconnected from GitHub${cause ? ` (${cause})` : ""}. ComplianceHub will not check repositories until it is reconnected.`,
    nextAction: "Reconnect the GitHub App to resume checks.",
    tone: "neutral",
    checkedAt,
  };
}
