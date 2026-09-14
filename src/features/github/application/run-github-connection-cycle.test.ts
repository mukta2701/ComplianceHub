// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { READ_PERMISSIONS } from "./github-app-auth";
import type { ClaimedGitHubConnectionReconciliation } from "./github-connection-store";
import {
  buildGitHubConnectionCycleRunner,
  type GitHubConnectionCycleDependencies,
} from "./run-github-connection-cycle";

const executionId = "10000000-0000-4000-8000-000000000001";

function claim(index: number): ClaimedGitHubConnectionReconciliation {
  return {
    runId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    workerId: executionId,
    organisationId: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    installationId: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    providerInstallationId: 70 + index,
    account: { id: 90 + index, login: `Company-${index}`, type: "Organization" },
    repositorySelection: "selected",
    permissions: READ_PERMISSIONS,
    selectedRepositoryIds: [100 + index],
    previousHealth: "retrying",
    consecutiveFailures: 1,
    attemptedAt: "2026-09-14T12:00:00.000Z",
  };
}

function dependencies(
  overrides: Partial<Pick<GitHubConnectionCycleDependencies, "now">> = {},
): GitHubConnectionCycleDependencies & {
  drainConnectionWebhooks: ReturnType<typeof vi.fn>;
  claimDue: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
  acknowledgeConnectionNotice: ReturnType<typeof vi.fn>;
} {
  return {
    now: () => new Date("2026-09-14T12:00:00.000Z"),
    drainConnectionWebhooks: vi.fn().mockResolvedValue({
      claimed: 0, processed: 0, ignored: 0, failed: 0, ownershipLost: 0,
    }),
    claimDue: vi.fn().mockResolvedValue([]),
    reconcile: vi.fn().mockResolvedValue({
      outcome: "success",
      diagnostic: null,
      nextAttemptAt: "2026-09-15T12:00:00.000Z",
      repositorySnapshot: [],
      incidentTransition: "none",
      effectiveHealth: "healthy",
    }),
    acknowledgeConnectionNotice: vi.fn().mockResolvedValue({ inAppQueued: 0, slackQueued: 0 }),
    ...overrides,
  };
}

const cycleInput = {
  executionId,
  maximumWebhookDeliveries: 20,
  maximumInstallations: 10,
  timeBudgetMs: 180_000,
};

describe("runGitHubConnectionCycle", () => {
  it("converges duplicate webhook and schedule inputs without repeated processing", async () => {
    let webhookPending = true;
    let installationDue = true;
    const deps = dependencies();
    deps.drainConnectionWebhooks.mockImplementation(async () => {
      if (!webhookPending) return { claimed: 0, processed: 0, ignored: 0, failed: 0, ownershipLost: 0 };
      webhookPending = false;
      installationDue = true;
      return { claimed: 1, processed: 1, ignored: 0, failed: 0, ownershipLost: 0 };
    });
    deps.claimDue.mockImplementation(async () => {
      if (!installationDue) return [];
      installationDue = false;
      return [claim(1)];
    });
    const runCycle = buildGitHubConnectionCycleRunner(deps);

    const first = await runCycle(cycleInput);
    const second = await runCycle({ ...cycleInput, executionId: "10000000-0000-4000-8000-000000000002" });

    expect(first).toEqual({
      executionId,
      webhookDeliveriesClaimed: 1,
      installationsClaimed: 1,
      healthy: 1,
      retrying: 0,
      actionRequired: 0,
      recovered: 0,
      ownershipLost: 0,
    });
    expect(second).toEqual({
      executionId: "10000000-0000-4000-8000-000000000002",
      webhookDeliveriesClaimed: 0,
      installationsClaimed: 0,
      healthy: 0,
      retrying: 0,
      actionRequired: 0,
      recovered: 0,
      ownershipLost: 0,
    });
    expect(deps.reconcile).toHaveBeenCalledOnce();
  });

  it("passes both claim bounds unchanged and processes installations sequentially", async () => {
    let active = 0;
    let maximumActive = 0;
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1), claim(2)]);
    deps.reconcile.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        outcome: "temporary_failure",
        diagnostic: "provider_temporary_failure",
        nextAttemptAt: "2026-09-14T12:01:00.000Z",
        repositorySnapshot: [],
        incidentTransition: "none",
        effectiveHealth: "retrying",
      };
    });

    const result = await buildGitHubConnectionCycleRunner(deps)({
      ...cycleInput,
      maximumWebhookDeliveries: 7,
      maximumInstallations: 2,
    });

    expect(deps.drainConnectionWebhooks).toHaveBeenCalledWith({
      limit: 7,
      signal: expect.any(AbortSignal),
    });
    expect(deps.claimDue).toHaveBeenCalledWith({
      workerId: executionId,
      limit: 2,
      now: "2026-09-14T12:00:00.000Z",
      signal: expect.any(AbortSignal),
    });
    expect(maximumActive).toBe(1);
    expect(result).toMatchObject({ installationsClaimed: 2, retrying: 2 });
  });

  it.each([
    [{ ...cycleInput, executionId: "not-an-id" }],
    [{ ...cycleInput, maximumWebhookDeliveries: 0 }],
    [{ ...cycleInput, maximumWebhookDeliveries: 101 }],
    [{ ...cycleInput, maximumInstallations: 0 }],
    [{ ...cycleInput, maximumInstallations: 101 }],
    [{ ...cycleInput, timeBudgetMs: 0 }],
    [{ ...cycleInput, timeBudgetMs: 240_001 }],
  ])("rejects invalid or unbounded cycle input before persistence work", async (input) => {
    const deps = dependencies();
    await expect(buildGitHubConnectionCycleRunner(deps)(input)).rejects.toThrow("GitHub connection cycle failed");
    expect(deps.drainConnectionWebhooks).not.toHaveBeenCalled();
    expect(deps.claimDue).not.toHaveBeenCalled();
  });

  it("fails closed if persistence exceeds the requested claim bound", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1), claim(2)]);

    await expect(buildGitHubConnectionCycleRunner(deps)({
      ...cycleInput,
      maximumInstallations: 1,
    })).rejects.toThrow("GitHub connection cycle failed");
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it("stops between phases when the time budget is exhausted", async () => {
    let now = new Date("2026-09-14T12:00:00.000Z");
    const deps = dependencies({ now: () => now });
    deps.drainConnectionWebhooks.mockImplementation(async () => {
      now = new Date("2026-09-14T12:00:00.010Z");
      return { claimed: 1, processed: 1, ignored: 0, failed: 0, ownershipLost: 0 };
    });

    await expect(buildGitHubConnectionCycleRunner(deps)({
      ...cycleInput,
      timeBudgetMs: 10,
    })).rejects.toThrow("GitHub connection cycle failed");
    expect(deps.claimDue).not.toHaveBeenCalled();
  });

  it("stops before phase two when the cycle budget expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    try {
      let observedSignal: AbortSignal | undefined;
      const deps = dependencies({ now: () => new Date() });
      deps.drainConnectionWebhooks.mockImplementation(({ signal }) => {
        observedSignal = signal;
        if (!signal) return Promise.reject(new Error("missing cycle signal"));
        return new Promise((_resolve, reject) => {
          const stop = () => reject(signal.reason);
          if (signal.aborted) stop();
          else signal.addEventListener("abort", stop, { once: true });
        });
      });

      const pending = buildGitHubConnectionCycleRunner(deps)({
        ...cycleInput,
        timeBudgetMs: 10,
      });
      const rejected = expect(pending).rejects.toThrow("GitHub connection cycle failed");
      await vi.advanceTimersByTimeAsync(10);

      await rejected;
      expect(observedSignal?.aborted).toBe(true);
      expect(deps.claimDue).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a pending installation claim at the cycle budget without later work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    try {
      let observedSignal: AbortSignal | undefined;
      const deps = dependencies({ now: () => new Date() });
      deps.claimDue.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
        observedSignal = signal;
        if (!signal) return Promise.reject(new Error("missing cycle signal"));
        return new Promise((_resolve, reject) => {
          const stop = () => reject(signal.reason);
          if (signal.aborted) stop();
          else signal.addEventListener("abort", stop, { once: true });
        });
      });

      const pending = buildGitHubConnectionCycleRunner(deps)({
        ...cycleInput,
        timeBudgetMs: 10,
      });
      const rejected = expect(pending).rejects.toThrow("GitHub connection cycle failed");
      await vi.advanceTimersByTimeAsync(10);

      await rejected;
      expect(observedSignal?.aborted).toBe(true);
      expect(deps.reconcile).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts in-flight reconciliation at the cycle budget without starting later claims", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    try {
      const deps = dependencies({ now: () => new Date() });
      deps.claimDue.mockResolvedValue([claim(1), claim(2)]);
      deps.reconcile.mockImplementation((_claimed, signal?: AbortSignal) => {
        if (!signal) throw new Error("missing cycle signal");
        return new Promise((_resolve, reject) => {
          const stop = () => reject(signal.reason);
          if (signal.aborted) stop();
          else signal.addEventListener("abort", stop, { once: true });
        });
      });

      const pending = buildGitHubConnectionCycleRunner(deps)({
        ...cycleInput,
        timeBudgetMs: 10,
      });
      const rejected = expect(pending).rejects.toThrow("GitHub connection cycle failed");
      await vi.advanceTimersByTimeAsync(10);

      await rejected;
      expect(deps.reconcile).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("relays external abort during reconciliation and removes its listener without later work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    try {
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, "removeEventListener");
      const deps = dependencies({ now: () => new Date() });
      deps.claimDue.mockResolvedValue([claim(1), claim(2)]);
      deps.reconcile.mockImplementation((_claimed, signal?: AbortSignal) => {
        if (!signal) throw new Error("missing cycle signal");
        return new Promise((_resolve, reject) => {
          const stop = () => reject(signal.reason);
          if (signal.aborted) stop();
          else signal.addEventListener("abort", stop, { once: true });
        });
      });

      const pending = buildGitHubConnectionCycleRunner(deps)({
        ...cycleInput,
        signal: controller.signal,
      });
      const rejected = expect(pending).rejects.toThrow("GitHub connection cycle failed");
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(new Error(`private-${crypto.randomUUID()}`));
      await vi.advanceTimersByTimeAsync(0);

      await rejected;
      expect(deps.reconcile).toHaveBeenCalledOnce();
      expect(removeListener).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours an existing abort before claiming any work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("provider token must stay private"));
    const deps = dependencies();

    await expect(buildGitHubConnectionCycleRunner(deps)({
      ...cycleInput,
      signal: controller.signal,
    })).rejects.toThrow("GitHub connection cycle failed");
    expect(deps.drainConnectionWebhooks).not.toHaveBeenCalled();
    expect(deps.claimDue).not.toHaveBeenCalled();
  });

  it("checks abort after claiming and does not start an installation", async () => {
    const controller = new AbortController();
    const deps = dependencies();
    deps.claimDue.mockImplementation(async () => {
      controller.abort();
      return [claim(1)];
    });

    await expect(buildGitHubConnectionCycleRunner(deps)({
      ...cycleInput,
      signal: controller.signal,
    })).rejects.toThrow("GitHub connection cycle failed");
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it("isolates one installation persistence failure and records only a safe lost-ownership count", async () => {
    const providerDetail = crypto.randomUUID();
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1), claim(2)]);
    deps.reconcile
      .mockRejectedValueOnce(new Error(`credential ${providerDetail}`))
      .mockResolvedValueOnce({
        outcome: "success",
        diagnostic: null,
        nextAttemptAt: "2026-09-15T12:00:00.000Z",
        repositorySnapshot: [],
        incidentTransition: "recovered",
        effectiveHealth: "healthy",
      });

    const result = await buildGitHubConnectionCycleRunner(deps)(cycleInput);

    expect(deps.reconcile).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      installationsClaimed: 2,
      healthy: 1,
      recovered: 1,
      ownershipLost: 1,
    });
    expect(JSON.stringify(result)).not.toContain(providerDetail);
    expect(JSON.stringify(result)).not.toContain(claim(1).organisationId);
    expect(JSON.stringify(result)).not.toContain(claim(1).installationId);
    expect(JSON.stringify(result)).not.toContain(String(claim(1).providerInstallationId));
  });

  it("counts a superseded provider success from its effective fail-closed health", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1)]);
    deps.reconcile.mockResolvedValue({
      outcome: "success",
      diagnostic: null,
      nextAttemptAt: "2026-09-15T12:00:00.000Z",
      repositorySnapshot: [],
      incidentTransition: "remained_open",
      effectiveHealth: "owner_action_required",
    });

    await expect(buildGitHubConnectionCycleRunner(deps)(cycleInput)).resolves.toMatchObject({
      healthy: 0,
      retrying: 0,
      actionRequired: 1,
      recovered: 0,
      ownershipLost: 0,
    });
    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledWith({
      kind: "incident",
      runId: claim(1).runId,
      installationId: claim(1).installationId,
      organisationId: claim(1).organisationId,
      accountLogin: "Company-1",
      health: "owner_action_required",
      diagnostic: null,
      occurredAt: "2026-09-14T12:00:00.000Z",
      connectionHref: "/app/integrations",
    }, expect.any(AbortSignal));
  });

  it("acknowledges only the atomic opening transition for an immediate serious failure", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1)]);
    deps.reconcile.mockResolvedValue({
      outcome: "action_required",
      diagnostic: "permission_mismatch",
      nextAttemptAt: null,
      repositorySnapshot: [],
      incidentTransition: "opened",
      effectiveHealth: "owner_action_required",
    });

    await buildGitHubConnectionCycleRunner(deps)(cycleInput);

    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledOnce();
    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledWith({
      kind: "incident",
      runId: claim(1).runId,
      installationId: claim(1).installationId,
      organisationId: claim(1).organisationId,
      accountLogin: "Company-1",
      health: "owner_action_required",
      diagnostic: "permission_mismatch",
      occurredAt: "2026-09-14T12:00:00.000Z",
      connectionHref: "/app/integrations",
    }, expect.any(AbortSignal));
  });

  it("keeps a one-off temporary failure quiet when finalization returns none", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1)]);
    deps.reconcile.mockResolvedValue({
      outcome: "temporary_failure",
      diagnostic: "provider_temporary_failure",
      nextAttemptAt: "2026-09-14T12:01:00.000Z",
      repositorySnapshot: [],
      incidentTransition: "none",
      effectiveHealth: "retrying",
    });

    await buildGitHubConnectionCycleRunner(deps)(cycleInput);

    expect(deps.acknowledgeConnectionNotice).not.toHaveBeenCalled();
  });

  it("acknowledges a persistent temporary opening only when finalization reaches its threshold", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1)]);
    deps.reconcile.mockResolvedValue({
      outcome: "temporary_failure",
      diagnostic: "provider_temporary_failure",
      nextAttemptAt: "2026-09-14T12:15:00.000Z",
      repositorySnapshot: [],
      incidentTransition: "opened",
      effectiveHealth: "retrying",
    });

    await buildGitHubConnectionCycleRunner(deps)(cycleInput);

    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledOnce();
    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledWith(expect.objectContaining({
      runId: claim(1).runId,
      kind: "incident",
      health: "retrying",
      diagnostic: "provider_temporary_failure",
    }), expect.any(AbortSignal));
  });

  it("acknowledges a repeated open observation without synthesizing another transition", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1)]);
    deps.reconcile.mockResolvedValue({
      outcome: "action_required",
      diagnostic: "permission_mismatch",
      nextAttemptAt: null,
      repositorySnapshot: [],
      incidentTransition: "remained_open",
      effectiveHealth: "owner_action_required",
    });

    await buildGitHubConnectionCycleRunner(deps)(cycleInput);

    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledOnce();
    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledWith(expect.objectContaining({
      runId: claim(1).runId,
      kind: "incident",
    }), expect.any(AbortSignal));
  });

  it("acknowledges recovery only from the verified recovered transition", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1)]);
    deps.reconcile.mockResolvedValue({
      outcome: "success",
      diagnostic: null,
      nextAttemptAt: "2026-09-15T12:00:00.000Z",
      repositorySnapshot: [],
      incidentTransition: "recovered",
      effectiveHealth: "healthy",
    });

    await buildGitHubConnectionCycleRunner(deps)(cycleInput);

    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledOnce();
    expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledWith(expect.objectContaining({
      runId: claim(1).runId,
      kind: "recovery",
      health: "healthy",
      diagnostic: null,
    }), expect.any(AbortSignal));
  });

  it.each([
    [{
      outcome: "action_required",
      diagnostic: "permission_mismatch",
      nextAttemptAt: null,
      repositorySnapshot: [],
      incidentTransition: "opened",
      effectiveHealth: "owner_action_required",
    }, { healthy: 0, actionRequired: 1, recovered: 0 }],
    [{
      outcome: "success",
      diagnostic: null,
      nextAttemptAt: "2026-09-15T12:00:00.000Z",
      repositorySnapshot: [],
      incidentTransition: "recovered",
      effectiveHealth: "healthy",
    }, { healthy: 1, actionRequired: 0, recovered: 1 }],
  ])("keeps authoritative health accounting when acknowledgement transport fails", async (
    reconciliation,
    expected,
  ) => {
    const privateDetail = crypto.randomUUID();
    const deps = dependencies();
    deps.claimDue.mockResolvedValue([claim(1)]);
    deps.reconcile.mockResolvedValue(reconciliation);
    deps.acknowledgeConnectionNotice.mockRejectedValue(new Error(`transport ${privateDetail}`));

    const result = await buildGitHubConnectionCycleRunner(deps)(cycleInput);

    expect(result).toMatchObject({ ...expected, ownershipLost: 0 });
    expect(JSON.stringify(result)).not.toContain(privateDetail);
  });

  it("aborts a pending acknowledgement at the cycle deadline without later work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    try {
      let observedSignal: AbortSignal | undefined;
      const deps = dependencies({ now: () => new Date() });
      deps.claimDue.mockResolvedValue([claim(1), claim(2)]);
      deps.reconcile.mockResolvedValue({
        outcome: "action_required",
        diagnostic: "permission_mismatch",
        nextAttemptAt: null,
        repositorySnapshot: [],
        incidentTransition: "opened",
        effectiveHealth: "owner_action_required",
      });
      deps.acknowledgeConnectionNotice.mockImplementation((_notice, signal?: AbortSignal) => {
        observedSignal = signal;
        if (!signal) return Promise.reject(new Error("missing cycle signal"));
        return new Promise((_resolve, reject) => {
          const stop = () => reject(signal.reason);
          if (signal.aborted) stop();
          else signal.addEventListener("abort", stop, { once: true });
        });
      });

      const pending = buildGitHubConnectionCycleRunner(deps)({
        ...cycleInput,
        timeBudgetMs: 10,
      });
      const rejected = expect(pending).rejects.toThrow("GitHub connection cycle failed");
      await vi.advanceTimersByTimeAsync(10);

      await rejected;
      expect(observedSignal?.aborted).toBe(true);
      expect(deps.reconcile).toHaveBeenCalledOnce();
      expect(deps.acknowledgeConnectionNotice).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports partial, action-required, and disconnected results without identifiers", async () => {
    const deps = dependencies();
    deps.drainConnectionWebhooks.mockResolvedValue({
      claimed: 3, processed: 2, ignored: 0, failed: 0, ownershipLost: 1,
    });
    deps.claimDue.mockResolvedValue([claim(1), claim(2), claim(3)]);
    deps.reconcile
      .mockResolvedValueOnce({ outcome: "partial", diagnostic: "repository_unavailable", nextAttemptAt: "2026-09-15T12:00:00.000Z", repositorySnapshot: [], incidentTransition: "opened", effectiveHealth: "partially_unavailable" })
      .mockResolvedValueOnce({ outcome: "action_required", diagnostic: "permission_mismatch", nextAttemptAt: null, repositorySnapshot: [], incidentTransition: "opened", effectiveHealth: "owner_action_required" })
      .mockResolvedValueOnce({ outcome: "disconnected", diagnostic: "installation_revoked", nextAttemptAt: null, repositorySnapshot: [], incidentTransition: "remained_open", effectiveHealth: "disconnected" });

    const result = await buildGitHubConnectionCycleRunner(deps)(cycleInput);

    expect(result).toEqual({
      executionId,
      webhookDeliveriesClaimed: 3,
      installationsClaimed: 3,
      healthy: 0,
      retrying: 0,
      actionRequired: 3,
      recovered: 0,
      ownershipLost: 1,
    });
    expect(Object.keys(result).sort()).toEqual([
      "actionRequired", "executionId", "healthy", "installationsClaimed",
      "ownershipLost", "recovered", "retrying", "webhookDeliveriesClaimed",
    ]);
  });
});
