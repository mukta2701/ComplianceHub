import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/security/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/observability/logger";
import {
  drainNativeIntegrationSyncJobsUntilIdle,
  reconcileScheduledJiraConnections,
} from "@/features/integrations/application/native-sync-worker";
import {
  createSupabaseJiraWebhookLifecycleStore,
  drainJiraWebhookCleanup,
  type JiraWebhookLifecycleDatabase,
} from "@/features/integrations/application/jira-webhook-lifecycle";
import { createJiraOAuthGateway } from "@/features/integrations/application/jira-oauth";
import {
  createSupabaseJiraCleanupConnectionStore,
  getFreshJiraAccessToken,
  type JiraPersistenceDatabase,
} from "@/features/integrations/application/jira-token-store";
import { getJiraProviderConfig } from "@/features/integrations/application/provider-config";
import type { IntegrationSyncRpcDatabase } from "@/features/integrations/application/sync-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type WorkerDatabase = unknown;

export async function pruneIntegrationHistory(database: IntegrationSyncRpcDatabase) {
  const { data, error } = await database.rpc(
    "prune_native_integration_history",
    { row_limit: 500 },
  );
  if (error || typeof data !== "number") throw new Error("Integration retention failed");
  return { deleted: data };
}

export type IntegrationWorkerDependencies = {
  isAuthorised: (request: Request) => boolean;
  createDatabase: () => WorkerDatabase;
  cleanupJira: (database: WorkerDatabase, shouldContinue: () => boolean) => Promise<unknown>;
  scheduleJira: (database: WorkerDatabase) => Promise<unknown>;
  drainJobs: (
    database: WorkerDatabase,
    batchSize: number,
    maxBatches: number,
    timeBudgetMs: number,
  ) => Promise<unknown>;
  retainQueues: (database: WorkerDatabase) => Promise<unknown>;
  logFailure: (phase: string, error: unknown) => Promise<void>;
  now: () => number;
};

async function cleanupJira(database: WorkerDatabase, shouldContinue: () => boolean) {
  const gateway = createJiraOAuthGateway(getJiraProviderConfig());
  const store = createSupabaseJiraWebhookLifecycleStore(database as JiraWebhookLifecycleDatabase);
  return drainJiraWebhookCleanup({
    gateway,
    store,
    getAccessToken: (job) => getFreshJiraAccessToken({
      connectionId: job.connectionId,
      gateway,
      store: createSupabaseJiraCleanupConnectionStore(
        database as JiraPersistenceDatabase,
        { cleanupId: job.cleanupId, cleanupLockToken: job.lockToken },
      ),
    }),
    workerId: `integration-cleanup:${randomUUID()}`,
    batchSize: 20,
    shouldContinue,
  });
}

const defaults: IntegrationWorkerDependencies = {
  isAuthorised: isAuthorisedCron,
  createDatabase: createSupabaseServiceClient,
  cleanupJira,
  scheduleJira: (database) => reconcileScheduledJiraConnections(
    database as IntegrationSyncRpcDatabase, 20,
  ),
  drainJobs: (database, batchSize, maxBatches, timeBudgetMs) => drainNativeIntegrationSyncJobsUntilIdle(
    database as IntegrationSyncRpcDatabase, batchSize, maxBatches, timeBudgetMs,
  ),
  retainQueues: (database) => pruneIntegrationHistory(database as IntegrationSyncRpcDatabase),
  logFailure: (phase, error) => logError("cron", `integration worker ${phase} phase failed`, error),
  now: Date.now,
};

const totalBudgetMs = 50_000;
const finalReserveMs = 5_000;

export function createIntegrationWorkerHandler(deps: IntegrationWorkerDependencies = defaults) {
  return async function integrationWorker(request: Request) {
    if (!deps.isAuthorised(request)) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
    const database = deps.createDatabase();
    const startedAt = deps.now();
    const phaseFailures: string[] = [];
    async function phase<T>(name: string, operation: () => Promise<T>): Promise<T | undefined> {
      try { return await operation(); }
      catch (error) {
        phaseFailures.push(name);
        await deps.logFailure(name, error);
        return undefined;
      }
    }
    // Provider lifecycle obligations run before bulk checks. Scheduling is
    // cheap and durable, so both schedulers run even when cleanup is slow.
    const jiraCleanup = await phase("jiraCleanup", () => deps.cleanupJira(
      database,
      () => deps.now() - startedAt < 15_000,
    ));
    const jira = await phase("jira", () => deps.scheduleJira(database));
    const remaining = totalBudgetMs - finalReserveMs - (deps.now() - startedAt);
    const jobs = remaining >= 1_000
      ? await phase("jobs", () => deps.drainJobs(database, 20, 4, Math.min(45_000, remaining)))
      : undefined;
    const retained = totalBudgetMs - (deps.now() - startedAt) >= finalReserveMs
      ? await phase("retention", () => deps.retainQueues(database))
      : undefined;
    return NextResponse.json({ jiraCleanup, jira, jobs, retained, phaseFailures });
  };
}

const worker = createIntegrationWorkerHandler();

export async function GET(request: Request) { return worker(request); }
export async function POST(request: Request) { return worker(request); }
