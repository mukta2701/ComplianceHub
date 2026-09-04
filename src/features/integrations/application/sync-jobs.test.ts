import { describe, expect, it, vi } from "vitest";
import {
  IntegrationSyncError,
  createSupabaseIntegrationSyncJobStore,
  drainIntegrationSyncJobs,
  drainIntegrationSyncJobsUntilIdle,
  processIntegrationSyncJobById,
  retryDelayMs,
  type ClaimedIntegrationSyncJob,
  type IntegrationSyncJobStore,
} from "./sync-jobs";

const job = (attemptCount = 1): ClaimedIntegrationSyncJob => ({
  jobId: "10000000-0000-4000-8000-000000000001",
  organisationId: "10000000-0000-4000-8000-000000000002",
  provider: "github",
  connectionId: "10000000-0000-4000-8000-000000000003",
  targetId: "10000000-0000-4000-8000-000000000004",
  kind: "provider_webhook",
  payload: { eventType: "push" },
  attemptCount,
  lockedBy: "worker-one",
  lockToken: "10000000-0000-4000-8000-000000000005",
  webhookDeliveryId: "10000000-0000-4000-8000-000000000006",
  idempotencyKey: "webhook:delivery-one",
});

function store(claims: Array<ClaimedIntegrationSyncJob | null>): IntegrationSyncJobStore {
  return {
    claim: vi.fn(async () => claims.shift() ?? null),
    claimById: vi.fn(async () => claims.shift() ?? null),
    claimChild: vi.fn(async () => claims.shift() ?? null),
    readTreeStatus: vi.fn(async () => ({
      rootStatus: "completed" as const, childTotal: 0, childCompleted: 0,
      childQueued: 0, childRunning: 0, childRetrying: 0,
      childTerminal: 0, state: "completed" as const,
    })),
    renew: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
}

describe("durable native integration jobs", () => {
  it("uses exact one-minute exponential retries capped at one hour", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(7)).toBe(3_600_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });

  it("claims, executes, and completes each job using its lease", async () => {
    const queue = store([job(), null]);
    const execute = vi.fn(async () => undefined);

    await expect(drainIntegrationSyncJobs({ store: queue, execute, workerId: "worker-one", batchSize: 5 }))
      .resolves.toEqual({ claimed: 1, completed: 1, failed: 0, terminal: 0 });
    expect(execute).toHaveBeenCalledWith(
      job(), expect.any(Function), expect.any(AbortSignal),
    );
    expect(queue.complete).toHaveBeenCalledWith(job().jobId, job().lockToken);
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("isolates failures, records only a fixed code, and continues the batch", async () => {
    const first = job(2);
    const second = { ...job(1), jobId: "20000000-0000-4000-8000-000000000001", lockToken: "20000000-0000-4000-8000-000000000002" };
    const queue = store([first, second, null]);
    const secret = "provider-secret-that-must-never-persist";
    const execute = vi.fn()
      .mockRejectedValueOnce(new IntegrationSyncError("rate_limited", secret))
      .mockResolvedValueOnce(undefined);

    await expect(drainIntegrationSyncJobs({ store: queue, execute, workerId: "worker-one", batchSize: 5 }))
      .resolves.toEqual({ claimed: 2, completed: 1, failed: 1, terminal: 0 });
    expect(queue.fail).toHaveBeenCalledWith(first.jobId, first.lockToken, "rate_limited");
    expect(JSON.stringify(vi.mocked(queue.fail).mock.calls)).not.toContain(secret);
    expect(queue.complete).toHaveBeenCalledWith(second.jobId, second.lockToken);
  });

  it("preserves pipeline failures at the durable job boundary without persisting details", async () => {
    const claimed = job();
    const queue = store([claimed, null]);
    const unsafeDetail = "database response containing tenant data";
    const execute = vi.fn(async () => {
      throw new IntegrationSyncError("pipeline_error", unsafeDetail);
    });

    await expect(drainIntegrationSyncJobs({ store: queue, execute, workerId: "worker-one", batchSize: 5 }))
      .resolves.toEqual({ claimed: 1, completed: 0, failed: 1, terminal: 0 });
    expect(queue.fail).toHaveBeenCalledWith(claimed.jobId, claimed.lockToken, "pipeline_error");
    expect(JSON.stringify(vi.mocked(queue.fail).mock.calls)).not.toContain(unsafeDetail);
  });

  it("marks the twentieth failed attempt terminal and never exceeds the bounded batch", async () => {
    const terminal = job(20);
    const queue = store([terminal, job(), job(), null]);
    const execute = vi.fn(async () => { throw new Error("unsafe detail"); });

    await expect(drainIntegrationSyncJobs({ store: queue, execute, workerId: "worker-one", batchSize: 2 }))
      .resolves.toEqual({ claimed: 2, completed: 0, failed: 2, terminal: 1 });
    expect(queue.claim).toHaveBeenCalledTimes(2);
    expect(queue.fail).toHaveBeenNthCalledWith(1, terminal.jobId, terminal.lockToken, "unexpected_error");
  });

  it("does not fail or re-complete work when a completion lease is already gone", async () => {
    const queue = store([job(), null]);
    vi.mocked(queue.complete).mockResolvedValue(false);

    await expect(drainIntegrationSyncJobs({ store: queue, execute: vi.fn(), workerId: "worker-one", batchSize: 5 }))
      .resolves.toEqual({ claimed: 1, completed: 0, failed: 0, terminal: 0 });
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("claims only the returned webhook job for a post-response attempt", async () => {
    const claimed = job();
    const queue = store([claimed]);
    await expect(processIntegrationSyncJobById({
      store: queue,
      execute: vi.fn(),
      workerId: "webhook-worker",
      jobId: claimed.jobId,
    })).resolves.toEqual({ claimed: true, completed: true, failed: false, terminal: false });
    expect(queue.claimById).toHaveBeenCalledWith("webhook-worker", claimed.jobId);
    expect(queue.claim).not.toHaveBeenCalled();
  });

  it("claims only a target child owned by the requested parent", async () => {
    const claimed = job();
    const rpc = vi.fn(async () => ({
      data: [{
        job_id: claimed.jobId,
        organisation_id: claimed.organisationId,
        provider: claimed.provider,
        connection_id: claimed.connectionId,
        target_id: claimed.targetId,
        kind: claimed.kind,
        payload: claimed.payload,
        attempt_count: claimed.attemptCount,
        locked_by: claimed.lockedBy,
        lock_token: claimed.lockToken,
        webhook_delivery_id: claimed.webhookDeliveryId,
        idempotency_key: claimed.idempotencyKey,
      }],
      error: null,
    }));
    const queue = createSupabaseIntegrationSyncJobStore({ rpc });
    const parentJobId = "20000000-0000-4000-8000-000000000099";

    await expect(queue.claimChild("manual-worker", parentJobId)).resolves.toEqual(claimed);
    expect(rpc).toHaveBeenCalledWith("claim_integration_sync_child_job", {
      worker_id: "manual-worker",
      target_parent_job_id: parentJobId,
    });
  });

  it("reads one durable parent-tree state without exposing another queue", async () => {
    const parentJobId = "20000000-0000-4000-8000-000000000099";
    const rpc = vi.fn(async () => ({
      data: [{
        root_status: "completed",
        child_total: 3,
        child_completed: 1,
        child_queued: 1,
        child_running: 0,
        child_retrying: 1,
        child_terminal: 0,
        tree_state: "retrying",
      }],
      error: null,
    }));
    const queue = createSupabaseIntegrationSyncJobStore({ rpc });

    await expect(queue.readTreeStatus(parentJobId)).resolves.toEqual({
      rootStatus: "completed",
      childTotal: 3,
      childCompleted: 1,
      childQueued: 1,
      childRunning: 0,
      childRetrying: 1,
      childTerminal: 0,
      state: "retrying",
    });
    expect(rpc).toHaveBeenCalledWith("integration_sync_job_tree_status", {
      target_parent_job_id: parentJobId,
    });
  });

  it("rejects unbounded worker settings before claiming", async () => {
    const queue = store([job()]);
    await expect(drainIntegrationSyncJobs({ store: queue, execute: vi.fn(), workerId: "bad worker", batchSize: 1 }))
      .rejects.toThrow("Integration sync worker configuration is invalid");
    await expect(drainIntegrationSyncJobs({ store: queue, execute: vi.fn(), workerId: "worker", batchSize: 26 }))
      .rejects.toThrow("Integration sync worker configuration is invalid");
    expect(queue.claim).not.toHaveBeenCalled();
  });

  it("repeats bounded batches until a partial batch proves the due queue is drained", async () => {
    const first = job();
    const second = { ...job(), jobId: "20000000-0000-4000-8000-000000000001" };
    const third = { ...job(), jobId: "30000000-0000-4000-8000-000000000001" };
    const queue = store([first, second, third, null]);

    await expect(drainIntegrationSyncJobsUntilIdle({
      store: queue,
      execute: vi.fn(async () => undefined),
      workerId: "backlog-worker",
      batchSize: 2,
      maxBatches: 5,
      timeBudgetMs: 10_000,
      now: (() => {
        let value = 0;
        return () => value += 10;
      })(),
    })).resolves.toEqual({
      batches: 2, claimed: 3, completed: 3, failed: 0, terminal: 0, exhausted: false,
    });
    expect(queue.claim).toHaveBeenCalledTimes(4);
  });

  it("stops repeated draining at its batch budget and reports remaining work truthfully", async () => {
    const queue = store(Array.from({ length: 6 }, (_, index) => ({
      ...job(), jobId: `${index + 1}0000000-0000-4000-8000-000000000001`,
    })));
    await expect(drainIntegrationSyncJobsUntilIdle({
      store: queue, execute: vi.fn(), workerId: "bounded-worker",
      batchSize: 2, maxBatches: 2, timeBudgetMs: 10_000, now: () => 0,
    })).resolves.toMatchObject({ batches: 2, claimed: 4, exhausted: true });
  });

  it("checks the deadline before every claim and stops partway through a slow batch", async () => {
    const queue = store([job(), { ...job(), jobId: "20000000-0000-4000-8000-000000000001" }]);
    const clock = [0, 0, 10, 1_100];

    await expect(drainIntegrationSyncJobsUntilIdle({
      store: queue,
      execute: vi.fn(async () => undefined),
      workerId: "deadline-worker",
      batchSize: 20,
      maxBatches: 5,
      timeBudgetMs: 1_000,
      now: () => clock.shift() ?? 1_100,
    })).resolves.toEqual({
      batches: 1, claimed: 1, completed: 1, failed: 0, terminal: 0, exhausted: true,
    });
    expect(queue.claim).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight job before the shared deadline and preserves time to record its retry", async () => {
    vi.useFakeTimers();
    const queue = store([job(), null]);
    let receivedSignal: AbortSignal | undefined;
    const execute = vi.fn((...args: unknown[]) => new Promise<void>((_resolve, reject) => {
      receivedSignal = args[2] as AbortSignal | undefined;
      if (!receivedSignal) {
        reject(new Error("missing shared abort signal"));
        return;
      }
      const fail = () => reject(receivedSignal?.reason ?? new Error("aborted"));
      if (receivedSignal.aborted) fail();
      else receivedSignal.addEventListener("abort", fail, { once: true });
    }));
    try {
      const draining = drainIntegrationSyncJobsUntilIdle({
        store: queue,
        execute,
        workerId: "abort-worker",
        batchSize: 20,
        maxBatches: 5,
        timeBudgetMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(draining).resolves.toEqual({
        batches: 1, claimed: 1, completed: 0, failed: 1, terminal: 0, exhausted: true,
      });
      expect(receivedSignal?.aborted).toBe(true);
      expect(queue.fail).toHaveBeenCalledWith(job().jobId, job().lockToken, "provider_unavailable");
      expect(queue.complete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not claim process-by-id work after its caller deadline is already exhausted", async () => {
    const queue = store([job()]);
    const controller = new AbortController();
    controller.abort(new Error("deadline exhausted"));

    await expect(processIntegrationSyncJobById({
      store: queue,
      execute: vi.fn(),
      workerId: "expired-webhook-worker",
      jobId: job().jobId,
      signal: controller.signal,
    })).resolves.toEqual({ claimed: false, completed: false, failed: false, terminal: false });
    expect(queue.claimById).not.toHaveBeenCalled();
  });
});
