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
  recordNotice(input: {
    organisationId: string;
    installationId: string;
    kind: "incident" | "recovery";
    diagnostic: GitHubConnectionDiagnostic | null;
    accountLogin: string;
  }): Promise<{ incidentId: string | null; isNew: boolean; notifiedUserIds: string[] }>;
  resolveSlackChannelId(organisationId: string): Promise<string | null>;
  enqueueSlackAlert(input: {
    organisationId: string;
    channelId: string;
    installationId: string;
    kind: "incident" | "recovery";
    diagnostic: GitHubConnectionDiagnostic | null;
    payload: SafeSlackDeliveryPayload;
  }): Promise<{ deliveryId: string; lockToken: string } | null>;
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

const HEALTH_PHRASE: Record<GitHubConnectionNotice["health"], string> = {
  partially_unavailable: "some repositories are no longer visible",
  owner_action_required: "access needs an Owner decision",
  disconnected: "access was removed",
  healthy: "access was verified again",
  retrying: "temporary failures continue while automatic retry is scheduled",
};

export function toGitHubConnectionSlackPayload(notice: GitHubConnectionNotice): SafeSlackDeliveryPayload {
  const parsed = noticeSchema.safeParse(notice);
  if (!parsed.success) invalidNotice();
  const title = notice.kind === "recovery"
    ? `GitHub connection recovered — ${notice.accountLogin}`
    : `GitHub connection needs attention — ${notice.accountLogin}`;
  const detail = `GitHub access for ${notice.accountLogin}: ${HEALTH_PHRASE[notice.health]}.`
    + (notice.diagnostic ? ` Signal: ${notice.diagnostic}.` : "")
    + ` Observed ${notice.occurredAt}. Review the connection: ${notice.connectionHref}.`;
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
  const recorded = await deps.recordNotice({
    organisationId: notice.organisationId,
    installationId: notice.installationId,
    kind: notice.kind,
    diagnostic: notice.diagnostic,
    accountLogin: notice.accountLogin,
  });
  if (!recorded.isNew) return { inAppQueued: 0, slackQueued: 0 };
  const channelId = await deps.resolveSlackChannelId(notice.organisationId);
  if (!channelId) return { inAppQueued: recorded.notifiedUserIds.length, slackQueued: 0 };
  const lease = await deps.enqueueSlackAlert({
    organisationId: notice.organisationId,
    channelId,
    installationId: notice.installationId,
    kind: notice.kind,
    diagnostic: notice.diagnostic,
    payload: toGitHubConnectionSlackPayload(notice),
  });
  return { inAppQueued: recorded.notifiedUserIds.length, slackQueued: lease ? 1 : 0 };
}
