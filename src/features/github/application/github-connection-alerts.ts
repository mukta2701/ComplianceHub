import "server-only";

import { z } from "zod";

import {
  safeSlackText,
  type SafeSlackDeliveryPayload,
} from "@/features/monitoring/application/slack-alert-queue";
import type { GitHubConnectionDiagnostic } from "../domain/connection-health";

export type GitHubConnectionNotice = {
  kind: "incident" | "recovery";
  installationId: string;
  organisationId: string;
  accountLogin: string;
  health: "partially_unavailable" | "owner_action_required" | "disconnected" | "healthy" | "retrying";
  diagnostic: GitHubConnectionDiagnostic | null;
  occurredAt: string;
  connectionHref: "/app/integrations";
};

export type GitHubConnectionAlertDependencies = {
  projectNotice(input: {
    organisationId: string;
    installationId: string;
    kind: "incident" | "recovery";
    diagnostic: GitHubConnectionDiagnostic | null;
    accountLogin: string;
    channelId: string | null;
    payload: SafeSlackDeliveryPayload;
  }): Promise<{
    incidentId: string | null;
    isNew: boolean;
    notifiedUserIds: string[];
    slackQueued: boolean;
  }>;
  resolveSlackChannelId(
    organisationId: string,
    severity: SafeSlackDeliveryPayload["severity"],
  ): Promise<string | null>;
};

const noticeSchema = z.object({
  kind: z.enum(["incident", "recovery"]),
  installationId: z.uuid(),
  organisationId: z.uuid(),
  accountLogin: z.string().min(1).max(100),
  health: z.enum(["partially_unavailable", "owner_action_required", "disconnected", "healthy", "retrying"]),
  diagnostic: z.enum([
    "provider_rate_limited", "provider_temporary_failure", "installation_suspended",
    "installation_revoked", "permission_mismatch", "account_mismatch",
    "repository_unavailable", "invalid_provider_response", "internal_failure",
  ]).nullable(),
  occurredAt: z.string().datetime({ offset: true }),
  connectionHref: z.literal("/app/integrations"),
}).strict();

function invalidNotice(): never {
  throw new Error("GitHub connection notice is invalid");
}

const INCIDENT_EXPLANATION: Record<GitHubConnectionDiagnostic, string> = {
  provider_rate_limited: "GitHub is temporarily limiting requests. ComplianceHub will try again. No action is needed now.",
  provider_temporary_failure: "ComplianceHub could not reach GitHub. It will try again.",
  installation_suspended: "The GitHub App is suspended. ComplianceHub cannot check the selected repositories. A workspace Owner must reactivate the App in GitHub.",
  installation_revoked: "GitHub access was removed. A workspace Owner must reconnect the App.",
  permission_mismatch: "The GitHub App is missing the required read-only permissions. A workspace Owner must review the App permissions in GitHub.",
  account_mismatch: "The App is connected to a different GitHub organisation. A workspace Owner must review the Connection.",
  repository_unavailable: "A selected repository is not available to the GitHub App. A workspace Owner must review repository access.",
  invalid_provider_response: "ComplianceHub could not read GitHub's response. It will try again.",
  internal_failure: "ComplianceHub could not complete the GitHub check. A workspace Owner must review the Connection.",
};

export function toGitHubConnectionSlackPayload(notice: GitHubConnectionNotice): SafeSlackDeliveryPayload {
  const parsed = noticeSchema.safeParse(notice);
  if (!parsed.success) invalidNotice();
  const title = notice.kind === "recovery"
    ? `GitHub monitoring restored for ${notice.accountLogin}`
    : notice.health === "retrying"
      ? `GitHub monitoring delayed for ${notice.accountLogin}`
      : notice.health === "partially_unavailable"
        ? `GitHub monitoring is incomplete for ${notice.accountLogin}`
        : `GitHub monitoring paused for ${notice.accountLogin}`;
  const explanation = notice.kind === "recovery"
    ? "GitHub access was verified again. Checks can resume. No action is needed."
    : notice.diagnostic
      ? INCIDENT_EXPLANATION[notice.diagnostic]
      : "ComplianceHub cannot verify GitHub access. A workspace Owner must review the Connection.";
  const detail = `${explanation} Open Settings > Connections.`;
  return {
    type: "connection_health",
    severity: notice.kind === "recovery" ? "medium" : notice.health === "disconnected" ? "critical" : "high",
    title: safeSlackText(title, 240),
    controlRef: "GitHub connection",
    subjectId: notice.installationId,
    detail: safeSlackText(detail, 500),
  };
}

export async function queueGitHubConnectionNotice(
  deps: GitHubConnectionAlertDependencies,
  notice: GitHubConnectionNotice,
): Promise<{ inAppQueued: number; slackQueued: number }> {
  if (!noticeSchema.safeParse(notice).success) invalidNotice();
  const payload = toGitHubConnectionSlackPayload(notice);
  const channelId = await deps.resolveSlackChannelId(notice.organisationId, payload.severity);
  const projected = await deps.projectNotice({
    organisationId: notice.organisationId,
    installationId: notice.installationId,
    kind: notice.kind,
    diagnostic: notice.diagnostic,
    accountLogin: notice.accountLogin,
    channelId,
    payload,
  });
  return {
    inAppQueued: projected.isNew ? projected.notifiedUserIds.length : 0,
    slackQueued: projected.slackQueued ? 1 : 0,
  };
}
