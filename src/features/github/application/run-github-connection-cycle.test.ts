// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  runGitHubConnectionCycle,
  type GitHubConnectionCycleDependencies,
} from "./run-github-connection-cycle";

const EXECUTION_ID = "11111111-1111-4111-8111-111111111111";
const INSTALLATION_UUID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    attemptCount: 1,
    providerDeliveryId: "delivery-1",
    eventName: "installation",
    providerInstallationId: 77,
    ...overrides,
  };
}

function dueRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    installationUuid: INSTALLATION_UUID,
    organisationId: "55555555-5555-4555-8555-555555555555",
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    installationUuid: INSTALLATION_UUID,
    providerInstallationId: 77,
    organisationId: "55555555-5555-4555-8555-555555555555",
    previousHealth: "healthy",
    consecutiveFailures: 0,
    expectedAccount: { id: 99, login: "Adtecher", type: "Organization" },
    ...overrides,
  };
}

function deps(overrides: Partial<GitHubConnectionCycleDependencies> = {}) {
  return {
    claimConnectionDeliveries: vi.fn().mockResolvedValue([]),
    finalizeConnectionDelivery: vi.fn().mockResolvedValue(true),
    scheduleConnection: vi.fn().mockResolvedValue(true),
    claimDueInstallations: vi.fn().mockResolvedValue([]),
    loadInstallationContext: vi.fn().mockResolvedValue(context()),
    reconcileClaim: vi.fn().mockResolvedValue({
      decision: { health: "healthy", retryAt: null, openIncident: false, closeIncident: false, diagnostic: null },
      repositoriesSeen: 2,
    }),
    notifyTransition: vi.fn().mockResolvedValue({ inAppQueued: 1, slackQueued: 0 }),
    ...overrides,
  };
}

const INPUT = {
  executionId: EXECUTION_ID,
  maximumWebhookDeliveries: 20,
  maximumInstallations: 10,
  timeBudgetMs: 60_000,
};

describe("runGitHubConnectionCycle", () => {
  it("drains duplicate webhook deliveries once and converges with the scheduled claim", async () => {
    const dependencies = deps({
      claimConnectionDeliveries: vi.fn().mockResolvedValue([
        delivery({ id: "44444444-4444-4444-8444-444444444444" }),
        delivery({ id: "55555555-5555-4555-8555-555555555555" }),
      ]),
      claimDueInstallations: vi.fn().mockResolvedValue([dueRun()]),
    });
    const summary = await runGitHubConnectionCycle(dependencies, INPUT);
    expect(summary).toMatchObject({
      executionId: EXECUTION_ID,
      webhookDeliveriesClaimed: 2,
      installationsClaimed: 1,
      healthy: 1,
    });
    expect(dependencies.scheduleConnection).toHaveBeenCalledTimes(2);
    expect(dependencies.scheduleConnection).toHaveBeenCalledWith(77);
    expect(dependencies.reconcileClaim).toHaveBeenCalledTimes(1);
    expect(dependencies.reconcileClaim).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      installationUuid: INSTALLATION_UUID,
      providerInstallationId: 77,
    }));
    expect(dependencies.finalizeConnectionDelivery).toHaveBeenCalledTimes(2);
  });

  it("rejects out-of-contract bounds without touching the provider", async () => {
    const dependencies = deps();
    for (const patch of [
      { executionId: "not-a-uuid" },
      { maximumWebhookDeliveries: 0 },
      { maximumWebhookDeliveries: 101 },
      { maximumInstallations: 0 },
      { maximumInstallations: 101 },
      { timeBudgetMs: 0 },
      { timeBudgetMs: 300_001 },
    ]) {
      await expect(runGitHubConnectionCycle(dependencies, { ...INPUT, ...patch })).rejects.toThrow(
        "GitHub connection cycle configuration is invalid",
      );
    }
    expect(dependencies.claimConnectionDeliveries).not.toHaveBeenCalled();
    expect(dependencies.claimDueInstallations).not.toHaveBeenCalled();
  });

  it("stops when the time budget expires instead of starting new work", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000).mockReturnValue(1_000 + 60_001);
    try {
      const dependencies = deps();
      await expect(runGitHubConnectionCycle(dependencies, INPUT)).rejects.toThrow(
        "GitHub connection cycle exceeded its time budget",
      );
      expect(dependencies.claimConnectionDeliveries).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it("aborts promptly and reports the interruption", async () => {
    const controller = new AbortController();
    controller.abort();
    const dependencies = deps({
      claimConnectionDeliveries: vi.fn().mockResolvedValue([delivery()]),
    });
    await expect(runGitHubConnectionCycle(dependencies, { ...INPUT, signal: controller.signal })).rejects.toThrow(
      "GitHub connection cycle was aborted",
    );
    expect(dependencies.finalizeConnectionDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ id: "44444444-4444-4444-8444-444444444444" }),
      "failed",
      "internal_error",
    );
  });

  it("does not finalise a delivery after the shared deadline expires during scheduling", async () => {
    const controller = new AbortController();
    const dependencies = deps({
      claimConnectionDeliveries: vi.fn().mockResolvedValue([delivery()]),
      scheduleConnection: vi.fn().mockImplementation(async () => {
        controller.abort(new Error("deadline expired during scheduling"));
        return true;
      }),
    });
    await expect(runGitHubConnectionCycle(dependencies, { ...INPUT, signal: controller.signal })).rejects.toThrow(
      "GitHub connection cycle was aborted",
    );
    expect(dependencies.finalizeConnectionDelivery).not.toHaveBeenCalled();
  });

  it("isolates one installation failure without losing the others", async () => {
    const dependencies = deps({
      claimDueInstallations: vi.fn().mockResolvedValue([
        dueRun(),
        dueRun({ runId: "66666666-6666-4666-8666-666666666666", installationUuid: "77777777-7777-4777-8777-777777777777" }),
      ]),
      loadInstallationContext: vi.fn()
        .mockResolvedValueOnce(context())
        .mockRejectedValueOnce(new Error("store unavailable")),
      reconcileClaim: vi.fn().mockResolvedValue({
        decision: { health: "healthy", retryAt: null, openIncident: false, closeIncident: false, diagnostic: null },
        repositoriesSeen: 1,
      }),
    });
    const summary = await runGitHubConnectionCycle(dependencies, INPUT);
    expect(summary).toMatchObject({ installationsClaimed: 2, healthy: 1, ownershipLost: 1 });
  });

  it("buckets every decision outcome into the safe summary", async () => {
    const decisions = [
      { health: "healthy", closeIncident: false },
      { health: "healthy", closeIncident: true },
      { health: "retrying", closeIncident: false },
      { health: "owner_action_required", closeIncident: false },
      { health: "partially_unavailable", closeIncident: false },
      { health: "disconnected", closeIncident: false },
    ];
    const dependencies = deps({
      claimDueInstallations: vi.fn().mockResolvedValue(decisions.map((decision, index) => dueRun({
        runId: `66666666-6666-4666-8666-66666666660${index}`,
        installationUuid: `77777777-7777-4777-8777-77777777770${index}`,
      }))),
      reconcileClaim: vi.fn().mockImplementation((claim: { runId: string }) => {
        const index = Number(claim.runId.slice(-1));
        const decision = decisions[index] as { health: string; closeIncident: boolean };
        return Promise.resolve({
          decision: { retryAt: null, openIncident: false, diagnostic: null, ...decision },
          repositoriesSeen: 1,
        });
      }),
    });
    const summary = await runGitHubConnectionCycle(dependencies, INPUT);
    expect(summary).toMatchObject({
      installationsClaimed: 6,
      healthy: 1,
      recovered: 1,
      retrying: 1,
      actionRequired: 3,
      ownershipLost: 0,
    });
  });

  it("leaves malformed deliveries unfinalised but counted", async () => {
    const dependencies = deps({
      claimConnectionDeliveries: vi.fn().mockResolvedValue([{ id: "not-a-uuid" }]),
    });
    const summary = await runGitHubConnectionCycle(dependencies, INPUT);
    expect(summary).toMatchObject({ webhookDeliveriesClaimed: 1, ownershipLost: 1 });
    expect(dependencies.finalizeConnectionDelivery).not.toHaveBeenCalled();
    expect(dependencies.scheduleConnection).not.toHaveBeenCalled();
  });
});

describe("runGitHubConnectionCycle transition notices", () => {
  it("notifies an incident when reconciliation opens one", async () => {
    const dependencies = deps({
      claimDueInstallations: vi.fn().mockResolvedValue([dueRun()]),
      reconcileClaim: vi.fn().mockResolvedValue({
        decision: { health: "partially_unavailable", retryAt: null, openIncident: true, closeIncident: false, diagnostic: "repository_unavailable" },
        repositoriesSeen: 1,
      }),
    });
    await runGitHubConnectionCycle(dependencies, INPUT);
    expect(dependencies.notifyTransition).toHaveBeenCalledTimes(1);
    expect(dependencies.notifyTransition).toHaveBeenCalledWith({
      kind: "incident",
      installationId: INSTALLATION_UUID,
      organisationId: "55555555-5555-4555-8555-555555555555",
      accountLogin: "Adtecher",
      health: "partially_unavailable",
      diagnostic: "repository_unavailable",
      occurredAt: expect.any(String),
    });
  });

  it("notifies recovery when reconciliation closes an incident", async () => {
    const dependencies = deps({
      claimDueInstallations: vi.fn().mockResolvedValue([dueRun()]),
      reconcileClaim: vi.fn().mockResolvedValue({
        decision: { health: "healthy", retryAt: null, openIncident: false, closeIncident: true, diagnostic: null },
        repositoriesSeen: 1,
      }),
    });
    const summary = await runGitHubConnectionCycle(dependencies, INPUT);
    expect(summary).toMatchObject({ recovered: 1 });
    expect(dependencies.notifyTransition).toHaveBeenCalledWith(expect.objectContaining({ kind: "recovery", health: "healthy" }));
  });

  it("projects a no-op recovery after every healthy check and counts a failed notice as lost", async () => {
    const quiet = deps({ claimDueInstallations: vi.fn().mockResolvedValue([dueRun()]) });
    await runGitHubConnectionCycle(quiet, INPUT);
    expect(quiet.notifyTransition).toHaveBeenCalledWith(expect.objectContaining({ kind: "recovery", health: "healthy" }));

    const failing = deps({
      claimDueInstallations: vi.fn().mockResolvedValue([dueRun()]),
      reconcileClaim: vi.fn().mockResolvedValue({
        decision: { health: "owner_action_required", retryAt: null, openIncident: true, closeIncident: false, diagnostic: "permission_mismatch" },
        repositoriesSeen: 0,
      }),
      notifyTransition: vi.fn().mockRejectedValue(new Error("notice store unavailable")),
    });
    const summary = await runGitHubConnectionCycle(failing, INPUT);
    expect(summary).toMatchObject({ actionRequired: 1, ownershipLost: 1 });
  });
});
