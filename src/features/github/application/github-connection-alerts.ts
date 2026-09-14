import "server-only";

import { z } from "zod";

import type {
  GitHubConnectionDiagnostic,
  GitHubConnectionHealth,
} from "../domain/connection-health";

export type GitHubConnectionNotice = {
  kind: "incident" | "recovery";
  runId: string;
  installationId: string;
  organisationId: string;
  accountLogin: string;
  health: GitHubConnectionHealth;
  diagnostic: GitHubConnectionDiagnostic | null;
  occurredAt: string;
  connectionHref: "/app/integrations";
};

export type GitHubConnectionAlertDependencies = {
  project(notice: GitHubConnectionNotice, signal?: AbortSignal): Promise<unknown>;
};

type RpcResult = PromiseLike<{ data: unknown; error: unknown }> & {
  abortSignal(signal: AbortSignal): RpcResult;
};
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): RpcResult;
};

const diagnostic = z.enum([
  "provider_rate_limited",
  "provider_temporary_failure",
  "installation_suspended",
  "installation_revoked",
  "permission_mismatch",
  "account_mismatch",
  "repository_unavailable",
  "invalid_provider_response",
  "internal_failure",
]);

const noticeSchema = z.object({
  kind: z.enum(["incident", "recovery"]),
  runId: z.string().uuid(),
  installationId: z.string().uuid(),
  organisationId: z.string().uuid(),
  accountLogin: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  health: z.enum([
    "retrying",
    "partially_unavailable",
    "owner_action_required",
    "disconnected",
    "healthy",
  ]),
  diagnostic: diagnostic.nullable(),
  occurredAt: z.string().datetime({ offset: true }),
  connectionHref: z.literal("/app/integrations"),
}).strict().superRefine((notice, context) => {
  if (notice.kind === "recovery" && (notice.health !== "healthy" || notice.diagnostic !== null)) {
    context.addIssue({ code: "custom", message: "recovery notice is inconsistent" });
  }
  if (notice.kind === "incident" && notice.health === "healthy") {
    context.addIssue({ code: "custom", message: "incident notice is inconsistent" });
  }
});

const queueResultSchema = z.object({
  inAppQueued: z.number().int().nonnegative(),
  slackQueued: z.number().int().nonnegative(),
}).strict();

function queueFailure(): Error {
  return new Error("GitHub connection alert queue failed");
}

function requireActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw queueFailure();
}

export function buildGitHubConnectionAlertDependencies(
  database: RpcClient,
): GitHubConnectionAlertDependencies {
  return {
    async project(notice, signal) {
      requireActive(signal);
      const query = database.rpc("project_github_connection_notice_server", {
        target_run_id: notice.runId,
        target_organisation_id: notice.organisationId,
        target_installation_id: notice.installationId,
        target_account_login: notice.accountLogin,
        target_kind: notice.kind,
        target_health: notice.health,
        target_diagnostic_code: notice.diagnostic,
        target_occurred_at: notice.occurredAt,
      });
      const { data, error } = await (signal ? query.abortSignal(signal) : query);
      requireActive(signal);
      if (error) throw queueFailure();
      return data;
    },
  };
}

export async function queueGitHubConnectionNotice(
  dependencies: GitHubConnectionAlertDependencies,
  notice: GitHubConnectionNotice,
  signal?: AbortSignal,
): Promise<{ inAppQueued: number; slackQueued: number }> {
  try {
    requireActive(signal);
    const safeNotice = noticeSchema.parse(notice);
    const result = queueResultSchema.parse(await dependencies.project(safeNotice, signal));
    requireActive(signal);
    return result;
  } catch {
    throw queueFailure();
  }
}
