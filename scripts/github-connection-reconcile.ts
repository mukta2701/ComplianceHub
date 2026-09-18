import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { createAppJwt, createInstallationToken } from "@/features/github/application/github-app-auth";
import { getGitHubConnectionConfig } from "@/features/github/application/github-runtime-config";
import {
  claimDueReconciliations,
  enqueueConnectionSlackAlert,
  finalizeReconciliationRun,
  listSelectedRepositoryIds,
  listStoredRepositories,
  loadInstallationContext,
  recordConnectionNotice,
  resolveConnectionSlackChannel,
  scheduleConnectionReconciliation,
  type ConnectionStoreClient,
  type StoredReconciliationRun,
} from "@/features/github/application/github-connection-store";
import {
  queueGitHubConnectionNotice,
  type GitHubConnectionNotice,
} from "@/features/github/application/github-connection-alerts";
import { readInstallationSnapshot } from "@/features/github/application/github-installation-api";
import {
  reconcileGitHubConnection,
  type ClaimedGitHubConnectionReconciliation,
} from "@/features/github/application/reconcile-github-connection";
import {
  runGitHubConnectionCycle,
  type GitHubConnectionCycleSummary,
} from "@/features/github/application/run-github-connection-cycle";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type CycleEnvironment = {
  maximumWebhookDeliveries: number;
  maximumInstallations: number;
  timeBudgetMs: number;
};

function invalidCycleEnvironment(): never {
  throw new Error("GitHub connection cycle configuration is invalid");
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) invalidCycleEnvironment();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) invalidCycleEnvironment();
  return parsed;
}

export function parseCycleEnvironment(env: Record<string, string | undefined>): CycleEnvironment {
  return {
    maximumWebhookDeliveries: boundedInteger(env.GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES, 20, 1, 100),
    maximumInstallations: boundedInteger(env.GITHUB_CONNECTION_MAX_INSTALLATIONS, 10, 1, 100),
    timeBudgetMs: boundedInteger(env.GITHUB_CONNECTION_TIME_BUDGET_MS, 240_000, 1, 300_000),
  };
}

export function summariseCycleForLog(executionId: string, summary: GitHubConnectionCycleSummary): string {
  return [
    `github-connection-reconcile execution=${executionId}`,
    `webhookDeliveriesClaimed=${summary.webhookDeliveriesClaimed}`,
    `installationsClaimed=${summary.installationsClaimed}`,
    `healthy=${summary.healthy}`,
    `retrying=${summary.retrying}`,
    `actionRequired=${summary.actionRequired}`,
    `recovered=${summary.recovered}`,
    `ownershipLost=${summary.ownershipLost}`,
  ].join(" ");
}

export function exitCodeForCycle(error: unknown): number {
  return error === null ? 0 : 1;
}

type ServiceClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): Promise<{ data: unknown; error: unknown }> & {
        single(): Promise<{ data: unknown; error: unknown }>;
      };
      single(): Promise<{ data: unknown; error: unknown }>;
    };
  };
};

function asStoreClient(service: ServiceClient): ConnectionStoreClient {
  return {
    rpc: (name, args) => service.rpc(name, args),
    from: (table) => (service as unknown as ConnectionStoreClient["from"])(table),
  };
}

async function main(): Promise<void> {
  const executionId = randomUUID();
  const controller = new AbortController();
  const onAbortSignal = () => controller.abort();
  process.once("SIGTERM", onAbortSignal);
  process.once("SIGINT", onAbortSignal);
  let failure: unknown = null;
  try {
    const environment = parseCycleEnvironment(process.env);
    const config = getGitHubConnectionConfig();
    const service = createSupabaseServiceClient() as unknown as ServiceClient;
    const client = asStoreClient(service);
    const appJwt = await createAppJwt({ appId: config.appId, privateKey: config.privateKey }, new Date());

    const summary = await runGitHubConnectionCycle(
      {
        claimConnectionDeliveries: async (limit) => {
          const { data, error } = await service.rpc("claim_github_connection_webhook_deliveries_server", {
            target_limit: limit,
          });
          if (error || !Array.isArray(data)) throw new Error("GitHub connection cycle store is unavailable");
          return data.map((row) => {
            const record = row as Record<string, unknown>;
            return {
              id: record.id,
              attemptCount: record.attempt_count,
              providerDeliveryId: record.provider_delivery_id,
              eventName: record.event_name,
              providerInstallationId: record.provider_installation_id,
            };
          });
        },
        finalizeConnectionDelivery: async (delivery, outcome, diagnosticCode) => {
          const { data, error } = await service.rpc("finalize_github_webhook_delivery_server", {
            target_delivery_id: delivery.id,
            target_attempt_count: delivery.attemptCount,
            target_status: outcome,
            target_diagnostic_code: diagnosticCode,
          });
          if (error || typeof data !== "boolean") throw new Error("GitHub connection cycle store is unavailable");
          return data;
        },
        scheduleConnection: (providerInstallationId) =>
          scheduleConnectionReconciliation(client, providerInstallationId),
        claimDueInstallations: async (limit) => {
          const runs: StoredReconciliationRun[] = await claimDueReconciliations(client, {
            workerId: executionId,
            limit,
            nowIso: new Date().toISOString(),
          });
          return runs;
        },
        loadInstallationContext: (installationUuid) => loadInstallationContext(client, installationUuid),
        notifyTransition: (notice: {
          kind: "incident" | "recovery";
          installationId: string;
          organisationId: string;
          accountLogin: string;
          health: "partially_unavailable" | "owner_action_required" | "disconnected" | "healthy" | "retrying";
          diagnostic: string | null;
          occurredAt: string;
        }) =>
          queueGitHubConnectionNotice(
            {
              recordNotice: (recordInput) => recordConnectionNotice(client, recordInput),
              resolveSlackChannelId: (organisationId) => resolveConnectionSlackChannel(client, organisationId),
              enqueueSlackAlert: (enqueueInput) => enqueueConnectionSlackAlert(client, enqueueInput),
            },
            {
              kind: notice.kind,
              installationId: notice.installationId,
              organisationId: notice.organisationId,
              accountLogin: notice.accountLogin,
              health: notice.health as GitHubConnectionNotice["health"],
              diagnostic: notice.diagnostic as GitHubConnectionNotice["diagnostic"],
              occurredAt: notice.occurredAt,
              connectionHref: "/app/integrations",
            },
          ),
        reconcileClaim: async (claim: ClaimedGitHubConnectionReconciliation) => {
          const repositoryIds = await listSelectedRepositoryIds(client, claim.installationUuid);
          const installationToken = await createInstallationToken({
            installationId: claim.providerInstallationId,
            repositoryIds,
            appJwt,
          });
          return reconcileGitHubConnection(
            {
              readSnapshot: (input) => readInstallationSnapshot(input),
              provideCredentials: async () => ({ appJwt, installationToken: installationToken.token }),
              loadStoredRepositories: (installationUuid) => listStoredRepositories(client, installationUuid),
              finalize: (input) => finalizeReconciliationRun(client, { ...input, workerId: executionId }),
            },
            claim,
          );
        },
      },
      {
        executionId,
        maximumWebhookDeliveries: environment.maximumWebhookDeliveries,
        maximumInstallations: environment.maximumInstallations,
        timeBudgetMs: environment.timeBudgetMs,
        signal: controller.signal,
      },
    );
    process.stdout.write(`${summariseCycleForLog(executionId, summary)}\n`);
  } catch (error) {
    failure = error;
    const message = error instanceof Error ? error.message : "GitHub connection cycle failed";
    process.stderr.write(`github-connection-reconcile execution=${executionId} error=${message}\n`);
  } finally {
    process.removeListener("SIGTERM", onAbortSignal);
    process.removeListener("SIGINT", onAbortSignal);
  }
  process.exitCode = exitCodeForCycle(failure);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
