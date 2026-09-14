import "server-only";
import { z } from "zod";
import type { IntegrationProvider } from "../domain/provider";

export type IntegrationSyncFailureCode =
  | "provider_unavailable"
  | "rate_limited"
  | "invalid_response"
  | "configuration_error"
  | "pipeline_error"
  | "unexpected_error";

export class IntegrationSyncError extends Error {
  override readonly name = "IntegrationSyncError";

  constructor(readonly code: IntegrationSyncFailureCode, message = "Integration synchronization failed") {
    super(message);
  }
}

export type ClaimedIntegrationSyncJob = {
  jobId: string;
  organisationId: string;
  provider: IntegrationProvider;
  connectionId: string;
  targetId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  lockedBy: string;
  lockToken: string;
  webhookDeliveryId: string | null;
  idempotencyKey: string;
};

export type IntegrationSyncTreeState =
  | "completed"
  | "queued"
  | "running"
  | "retrying"
  | "terminal";

export type IntegrationSyncJobTreeStatus = {
  rootStatus: "queued" | "running" | "completed" | "failed" | "cancelled";
  childTotal: number;
  childCompleted: number;
  childQueued: number;
  childRunning: number;
  childRetrying: number;
  childTerminal: number;
  state: IntegrationSyncTreeState;
};

export type IntegrationSyncJobStore = {
  claim(workerId: string): Promise<ClaimedIntegrationSyncJob | null>;
  claimById(workerId: string, jobId: string): Promise<ClaimedIntegrationSyncJob | null>;
  claimChild(workerId: string, parentJobId: string): Promise<ClaimedIntegrationSyncJob | null>;
  readTreeStatus(parentJobId: string): Promise<IntegrationSyncJobTreeStatus>;
  renew(jobId: string, lockToken: string): Promise<boolean>;
  complete(jobId: string, lockToken: string): Promise<boolean>;
  fail(jobId: string, lockToken: string, code: IntegrationSyncFailureCode): Promise<boolean>;
};

export type IntegrationSyncJobExecutor = (
  job: ClaimedIntegrationSyncJob,
  renewLease: () => Promise<boolean>,
  signal: AbortSignal,
) => Promise<void>;

const workerPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const claimedJobSchema = z.object({
  job_id: z.uuid(),
  organisation_id: z.uuid(),
  provider: z.enum(["github", "jira"]),
  connection_id: z.uuid(),
  target_id: z.uuid().nullable(),
  kind: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  payload: z.record(z.string(), z.unknown()),
  attempt_count: z.number().int().min(1).max(20),
  locked_by: z.string().regex(workerPattern),
  lock_token: z.uuid(),
  webhook_delivery_id: z.uuid().nullable(),
  idempotency_key: z.string().min(1).max(255),
}).strict();

const treeStatusSchema = z.object({
  root_status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  child_total: z.number().int().min(0).max(10_000),
  child_completed: z.number().int().min(0).max(10_000),
  child_queued: z.number().int().min(0).max(10_000),
  child_running: z.number().int().min(0).max(10_000),
  child_retrying: z.number().int().min(0).max(10_000),
  child_terminal: z.number().int().min(0).max(10_000),
  tree_state: z.enum(["completed", "queued", "running", "retrying", "terminal"]),
}).strict();

function parseClaimedJob(value: unknown): ClaimedIntegrationSyncJob {
  const row = claimedJobSchema.parse(value);
  return {
    jobId: row.job_id,
    organisationId: row.organisation_id,
    provider: row.provider,
    connectionId: row.connection_id,
    targetId: row.target_id,
    kind: row.kind,
    payload: row.payload,
    attemptCount: row.attempt_count,
    lockedBy: row.locked_by,
    lockToken: row.lock_token,
    webhookDeliveryId: row.webhook_delivery_id,
    idempotencyKey: row.idempotency_key,
  };
}

export type IntegrationSyncRpcDatabase = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export function createSupabaseIntegrationSyncJobStore(
  database: IntegrationSyncRpcDatabase,
): IntegrationSyncJobStore {
  return {
    async claim(workerId) {
      const { data, error } = await database.rpc("claim_integration_sync_job", { worker_id: workerId });
      if (error || !Array.isArray(data) || data.length > 1) throw new Error("Integration sync claim failed");
      return data.length === 0 ? null : parseClaimedJob(data[0]);
    },
    async claimById(workerId, jobId) {
      const { data, error } = await database.rpc("claim_integration_sync_job_by_id", {
        worker_id: workerId,
        target_job_id: jobId,
      });
      if (error || !Array.isArray(data) || data.length > 1) throw new Error("Integration sync claim failed");
      return data.length === 0 ? null : parseClaimedJob(data[0]);
    },
    async claimChild(workerId, parentJobId) {
      const { data, error } = await database.rpc("claim_integration_sync_child_job", {
        worker_id: workerId,
        target_parent_job_id: parentJobId,
      });
      if (error || !Array.isArray(data) || data.length > 1) throw new Error("Integration sync claim failed");
      return data.length === 0 ? null : parseClaimedJob(data[0]);
    },
    async readTreeStatus(parentJobId) {
      const { data, error } = await database.rpc("integration_sync_job_tree_status", {
        target_parent_job_id: parentJobId,
      });
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new Error("Integration sync tree status failed");
      }
      const row = treeStatusSchema.parse(data[0]);
      return {
        rootStatus: row.root_status,
        childTotal: row.child_total,
        childCompleted: row.child_completed,
        childQueued: row.child_queued,
        childRunning: row.child_running,
        childRetrying: row.child_retrying,
        childTerminal: row.child_terminal,
        state: row.tree_state,
      };
    },
    async renew(jobId, lockToken) {
      const { data, error } = await database.rpc("renew_integration_sync_job_lease", {
        target_job_id: jobId,
        claimed_lock_token: lockToken,
      });
      if (error || typeof data !== "boolean") throw new Error("Integration sync lease renewal failed");
      return data;
    },
    async complete(jobId, lockToken) {
      const { data, error } = await database.rpc("complete_integration_sync_job", {
        target_job_id: jobId,
        claimed_lock_token: lockToken,
      });
      if (error || typeof data !== "boolean") throw new Error("Integration sync completion failed");
      return data;
    },
    async fail(jobId, lockToken, code) {
      const { data, error } = await database.rpc("fail_integration_sync_job", {
        target_job_id: jobId,
        claimed_lock_token: lockToken,
        failure_code: code,
      });
      if (error || typeof data !== "boolean") throw new Error("Integration sync failure recording failed");
      return data;
    },
  };
}

export function retryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 20) {
    throw new Error("Integration sync attempt is invalid");
  }
  return Math.min(60 * 60_000, 2 ** (attempt - 1) * 60_000);
}

function safeFailureCode(error: unknown): IntegrationSyncFailureCode {
  return error instanceof IntegrationSyncError ? error.code : "unexpected_error";
}

function deadlineError(): IntegrationSyncError {
  return new IntegrationSyncError("provider_unavailable");
}

function activeSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? new AbortController().signal;
}

async function executeWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw deadlineError();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(deadlineError()));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export async function drainIntegrationSyncJobs(input: {
  store: IntegrationSyncJobStore;
  execute: IntegrationSyncJobExecutor;
  workerId: string;
  batchSize?: number;
  shouldContinue?: () => boolean;
  signal?: AbortSignal;
}): Promise<{ claimed: number; completed: number; failed: number; terminal: number }> {
  const batchSize = input.batchSize ?? 10;
  if (!workerPattern.test(input.workerId) || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) {
    throw new Error("Integration sync worker configuration is invalid");
  }
  const summary = { claimed: 0, completed: 0, failed: 0, terminal: 0 };
  const signal = activeSignal(input.signal);
  for (let index = 0; index < batchSize; index += 1) {
    if (signal.aborted || (input.shouldContinue && !input.shouldContinue())) break;
    const job = await input.store.claim(input.workerId);
    if (!job) break;
    summary.claimed += 1;
    const result = await executeClaimedJob(input.store, input.execute, job, signal);
    summary.completed += result.completed;
    summary.failed += result.failed;
    summary.terminal += result.terminal;
  }
  return summary;
}

export async function drainIntegrationSyncJobsUntilIdle(input: {
  store: IntegrationSyncJobStore;
  execute: IntegrationSyncJobExecutor;
  workerId: string;
  batchSize?: number;
  maxBatches?: number;
  timeBudgetMs?: number;
  now?: () => number;
  signal?: AbortSignal;
}): Promise<{
  batches: number;
  claimed: number;
  completed: number;
  failed: number;
  terminal: number;
  exhausted: boolean;
}> {
  const batchSize = input.batchSize ?? 20;
  const maxBatches = input.maxBatches ?? 10;
  const timeBudgetMs = input.timeBudgetMs ?? 240_000;
  if (
    !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 20
    || !Number.isInteger(timeBudgetMs) || timeBudgetMs < 1_000 || timeBudgetMs > 240_000
  ) throw new Error("Integration sync worker configuration is invalid");
  const now = input.now ?? Date.now;
  const startedAt = now();
  const persistenceReserveMs = Math.min(3_000, Math.max(100, Math.floor(timeBudgetMs / 5)));
  const executionBudgetMs = timeBudgetMs - persistenceReserveMs;
  const deadline = new AbortController();
  const abortDeadline = () => {
    if (!deadline.signal.aborted) deadline.abort(deadlineError());
  };
  const onCallerAbort = () => abortDeadline();
  if (input.signal?.aborted) abortDeadline();
  else input.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const deadlineTimer = setTimeout(abortDeadline, executionBudgetMs);
  deadlineTimer.unref();
  const summary = {
    batches: 0, claimed: 0, completed: 0, failed: 0, terminal: 0, exhausted: false,
  };
  let lastBatchWasFull = false;
  try {
    while (summary.batches < maxBatches) {
      if (deadline.signal.aborted || now() - startedAt >= executionBudgetMs) {
        abortDeadline();
        summary.exhausted = lastBatchWasFull;
        return summary;
      }
      let deadlineReached = false;
      const batch = await drainIntegrationSyncJobs({
        store: input.store,
        execute: input.execute,
        workerId: input.workerId,
        batchSize,
        signal: deadline.signal,
        shouldContinue: () => {
          const canContinue = !deadline.signal.aborted
            && now() - startedAt < executionBudgetMs;
          if (!canContinue) {
            deadlineReached = true;
            abortDeadline();
          }
          return canContinue;
        },
      });
      summary.batches += 1;
      summary.claimed += batch.claimed;
      summary.completed += batch.completed;
      summary.failed += batch.failed;
      summary.terminal += batch.terminal;
      lastBatchWasFull = batch.claimed === batchSize;
      if (deadlineReached || deadline.signal.aborted) {
        summary.exhausted = true;
        return summary;
      }
      if (!lastBatchWasFull) return summary;
    }
    summary.exhausted = lastBatchWasFull;
    return summary;
  } finally {
    clearTimeout(deadlineTimer);
    input.signal?.removeEventListener("abort", onCallerAbort);
  }
}

async function executeClaimedJob(
  store: IntegrationSyncJobStore,
  execute: IntegrationSyncJobExecutor,
  job: ClaimedIntegrationSyncJob,
  signal: AbortSignal,
): Promise<{ completed: number; failed: number; terminal: number }> {
  const result = { completed: 0, failed: 0, terminal: 0 };
    try {
      await executeWithAbort(
        Promise.resolve(execute(job, () => store.renew(job.jobId, job.lockToken), signal)),
        signal,
      );
      if (signal.aborted) throw deadlineError();
      if (await store.complete(job.jobId, job.lockToken)) result.completed = 1;
    } catch (error) {
      try {
        if (await store.fail(job.jobId, job.lockToken, safeFailureCode(error))) {
          result.failed = 1;
          if (job.attemptCount >= 20) result.terminal = 1;
        }
      } catch {
        // A lost lease or storage failure is isolated to this job. The durable
        // stale-lease recovery path can reclaim it without leaking error detail.
      }
    }
  return result;
}

export async function processIntegrationSyncJobById(input: {
  store: IntegrationSyncJobStore;
  execute: IntegrationSyncJobExecutor;
  workerId: string;
  jobId: string;
  signal?: AbortSignal;
}): Promise<{ claimed: boolean; completed: boolean; failed: boolean; terminal: boolean }> {
  if (!workerPattern.test(input.workerId) || !z.uuid().safeParse(input.jobId).success) {
    throw new Error("Integration sync worker configuration is invalid");
  }
  const signal = activeSignal(input.signal);
  if (signal.aborted) return { claimed: false, completed: false, failed: false, terminal: false };
  const job = await input.store.claimById(input.workerId, input.jobId);
  if (!job) return { claimed: false, completed: false, failed: false, terminal: false };
  const result = await executeClaimedJob(input.store, input.execute, job, signal);
  return {
    claimed: true,
    completed: result.completed === 1,
    failed: result.failed === 1,
    terminal: result.terminal === 1,
  };
}
