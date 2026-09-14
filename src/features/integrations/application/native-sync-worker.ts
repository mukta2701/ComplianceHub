import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  syncJiraMonitorTarget,
  type JiraTargetSyncDatabase,
} from "@/features/monitoring/application/jira-target-sync";
import { getJiraProviderConfig } from "./provider-config";
import { createJiraOAuthGateway } from "./jira-oauth";
import { createSupabaseJiraConnectionStore, getFreshJiraAccessToken } from "./jira-token-store";
import {
  createSupabaseJiraWebhookLifecycleStore,
  ensureJiraWebhook,
  type JiraWebhookConfiguration,
} from "./jira-webhook-lifecycle";
import {
  createSupabaseIntegrationSyncJobStore,
  drainIntegrationSyncJobs,
  drainIntegrationSyncJobsUntilIdle,
  IntegrationSyncError,
  processIntegrationSyncJobById,
  type ClaimedIntegrationSyncJob,
  type IntegrationSyncRpcDatabase,
} from "./sync-jobs";

const supportedKinds = new Set([
  "provider_webhook",
  "manual_sync",
  "connection_reconciliation",
  "scheduled_reconciliation",
  "target_sync",
]);

export type NativeSyncExecutorPorts = {
  syncTarget?: (job: ClaimedIntegrationSyncJob, signal: AbortSignal) => Promise<void>;
  reconcileJira?: (job: ClaimedIntegrationSyncJob, signal: AbortSignal) => Promise<void>;
};

const jiraConnectionSchema = z.object({
  id: z.uuid(),
  organisation_id: z.uuid(),
  provider_account_id: z.uuid(),
  jira_webhook_generation: z.number().int().min(0).max(2_147_483_646),
  jira_webhook_id: z.string().regex(/^[1-9][0-9]{0,15}$/).nullable(),
  jira_webhook_expires_at: z.string().datetime({ offset: true }).nullable(),
  jira_webhook_callback_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
}).strip();

export async function reconcileJiraConnection(
  database: IntegrationSyncRpcDatabase,
  job: ClaimedIntegrationSyncJob,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const client = database as unknown as SupabaseClient;
  const { data, error } = await client.from("integration_connections")
    .select("id,organisation_id,provider_account_id,jira_webhook_generation,jira_webhook_id,jira_webhook_expires_at,jira_webhook_callback_hash")
    .eq("id", job.connectionId)
    .eq("organisation_id", job.organisationId)
    .eq("provider", "jira")
    .eq("connection_mode", "jira_oauth")
    .eq("enabled", true)
    .is("revoked_at", null)
    .maybeSingle();
  const parsed = jiraConnectionSchema.safeParse(data);
  if (error || !parsed.success) throw new Error("Jira connection reconciliation failed");
  const configuration: JiraWebhookConfiguration = {
    organisationId: parsed.data.organisation_id,
    connectionId: parsed.data.id,
    cloudId: parsed.data.provider_account_id,
    generation: parsed.data.jira_webhook_generation,
    webhookId: parsed.data.jira_webhook_id,
    webhookExpiresAt: parsed.data.jira_webhook_expires_at,
    callbackHash: parsed.data.jira_webhook_callback_hash,
  };
  const config = getJiraProviderConfig();
  const gateway = createJiraOAuthGateway(config, fetch, () => new Date(), signal);
  const webhookStore = createSupabaseJiraWebhookLifecycleStore(database);
  const [accessToken, projectKeys] = await Promise.all([
    getFreshJiraAccessToken({
      connectionId: job.connectionId,
      gateway,
      store: createSupabaseJiraConnectionStore(database),
    }),
    webhookStore.readProjectKeys(job.connectionId, configuration.generation),
  ]);
  signal?.throwIfAborted();
  await ensureJiraWebhook({
    gateway,
    store: webhookStore,
    accessToken,
    configuration,
    projectKeys,
    callbackBaseUrl: new URL(config.callbackUrl).origin,
  });
}

export function createNativeIntegrationSyncExecutor(
  database: IntegrationSyncRpcDatabase,
  ports: NativeSyncExecutorPorts = {},
) {
  return async (
    job: ClaimedIntegrationSyncJob,
    renewLease: () => Promise<boolean>,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> => {
    const requireActive = () => {
      if (signal.aborted) throw new IntegrationSyncError("provider_unavailable");
    };
    requireActive();
    if (job.provider !== "jira" || !supportedKinds.has(job.kind)) throw new IntegrationSyncError("configuration_error");
    if (!await renewLease()) throw new IntegrationSyncError("unexpected_error");
    requireActive();
    let heartbeatLost = false;
    let heartbeatPromise: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      if (heartbeatPromise) return;
      heartbeatPromise = renewLease()
        .then((renewed) => { if (!renewed) heartbeatLost = true; })
        .catch(() => { heartbeatLost = true; })
        .finally(() => { heartbeatPromise = null; });
    }, 60_000);
    heartbeat.unref();
    try {
      if (
        job.provider === "jira"
        && job.targetId === null
        && (
          job.kind === "connection_reconciliation"
          || job.kind === "scheduled_reconciliation"
          || job.kind === "manual_sync"
        )
      ) {
        try {
          await (ports.reconcileJira ?? ((value, activeSignal) => (
            reconcileJiraConnection(database, value, activeSignal)
          )))(job, signal);
        } catch {
          throw new IntegrationSyncError("provider_unavailable");
        }
        requireActive();
        if (!await renewLease()) throw new IntegrationSyncError("unexpected_error");
        requireActive();
      }
      if (job.targetId === null) {
        requireActive();
        const { data, error } = await database.rpc("fan_out_integration_sync_job", {
          target_parent_job_id: job.jobId,
          claimed_lock_token: job.lockToken,
        });
        if (
          error
          || typeof data !== "number"
          || !Number.isInteger(data)
          || data < 0
          || data > 10_000
        ) throw new IntegrationSyncError("unexpected_error");
        requireActive();
        if (heartbeatPromise) await heartbeatPromise;
        if (heartbeatLost || !await renewLease()) {
          throw new IntegrationSyncError("unexpected_error");
        }
        return;
      }
      await (ports.syncTarget ?? ((value, activeSignal) => syncJiraMonitorTarget(
        database as unknown as JiraTargetSyncDatabase,
        value,
        activeSignal,
      )))(job, signal);
      requireActive();
      if (heartbeatPromise) await heartbeatPromise;
      if (heartbeatLost) throw new IntegrationSyncError("unexpected_error");
      if (!await renewLease()) throw new IntegrationSyncError("unexpected_error");
    } finally {
      clearInterval(heartbeat);
    }
  };
}

export async function processNativeIntegrationSyncJob(
  database: IntegrationSyncRpcDatabase,
  jobId: string,
  signal: AbortSignal = AbortSignal.timeout(12_000),
) {
  return processIntegrationSyncJobById({
    store: createSupabaseIntegrationSyncJobStore(database),
    execute: createNativeIntegrationSyncExecutor(database),
    workerId: `webhook:${randomUUID()}`,
    jobId,
    signal,
  });
}

export async function processNativeIntegrationSyncJobAndDrain(
  database: IntegrationSyncRpcDatabase,
  jobId: string,
  options: { batchSize?: number; maxBatches?: number; timeBudgetMs?: number } = {},
) {
  const timeBudgetMs = options.timeBudgetMs ?? 12_000;
  const signal = AbortSignal.timeout(timeBudgetMs);
  const store = createSupabaseIntegrationSyncJobStore(database);
  const job = await processNativeIntegrationSyncJob(database, jobId, signal);
  const initialStatus = await store.readTreeStatus(jobId);
  if (initialStatus.rootStatus !== "completed") {
    return { job, drain: null, state: initialStatus.state };
  }
  if (initialStatus.state === "completed" || initialStatus.state === "terminal" || signal.aborted) {
    return {
      job,
      drain: {
        batches: 0, claimed: 0, completed: 0, failed: 0, terminal: 0,
        exhausted: signal.aborted && initialStatus.state !== "completed",
      },
      state: initialStatus.state,
    };
  }
  const scopedStore = {
    ...store,
    // A manual request may only influence the children fanned out by its exact
    // parent. Never let another tenant's queue change this card's outcome.
    claim: (workerId: string) => store.claimChild(workerId, jobId),
  };
  const drain = await drainIntegrationSyncJobsUntilIdle({
    store: scopedStore,
    execute: createNativeIntegrationSyncExecutor(database),
    workerId: `wake:${randomUUID()}`,
    batchSize: options.batchSize ?? 10,
    maxBatches: options.maxBatches ?? 2,
    timeBudgetMs,
    signal,
  });
  const finalStatus = await store.readTreeStatus(jobId);
  return {
    job,
    drain: {
      ...drain,
      exhausted: (drain.exhausted || signal.aborted) && finalStatus.state !== "completed",
    },
    state: finalStatus.state,
  };
}

export async function drainNativeIntegrationSyncJobs(
  database: IntegrationSyncRpcDatabase,
  batchSize = 20,
) {
  const signal = AbortSignal.timeout(47_000);
  return drainIntegrationSyncJobs({
    store: createSupabaseIntegrationSyncJobStore(database),
    execute: createNativeIntegrationSyncExecutor(database),
    workerId: `cron:${randomUUID()}`,
    batchSize,
    signal,
  });
}

export async function drainNativeIntegrationSyncJobsUntilIdle(
  database: IntegrationSyncRpcDatabase,
  batchSize = 20,
  maxBatches = 10,
  timeBudgetMs = 240_000,
) {
  return drainIntegrationSyncJobsUntilIdle({
    store: createSupabaseIntegrationSyncJobStore(database),
    execute: createNativeIntegrationSyncExecutor(database),
    workerId: `cron:${randomUUID()}`,
    batchSize,
    maxBatches,
    timeBudgetMs,
  });
}

export async function reconcileScheduledJiraConnections(
  database: IntegrationSyncRpcDatabase,
  limit = 20,
): Promise<{ queued: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("Jira reconciliation configuration is invalid");
  }
  const { data, error } = await database.rpc("enqueue_due_jira_reconciliations", {
    result_limit: limit,
  });
  if (error || typeof data !== "number" || !Number.isInteger(data) || data < 0 || data > limit) {
    throw new Error("Jira reconciliation could not be scheduled");
  }
  return { queued: data };
}
