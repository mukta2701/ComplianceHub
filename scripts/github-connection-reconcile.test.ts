// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  exitCodeForCycle,
  parseCycleEnvironment,
  runGitHubConnectionReconcile,
  runGitHubConnectionReconcileCli,
  summariseCycleForLog,
} from "./github-connection-reconcile";

describe("github-connection-reconcile entry point", () => {
  it("applies bounded defaults for missing cycle configuration", () => {
    expect(parseCycleEnvironment({})).toEqual({
      maximumWebhookDeliveries: 20,
      maximumInstallations: 10,
      maximumSlackDeliveries: 10,
      timeBudgetMs: 240_000,
    });
  });

  it("accepts explicit values inside the tested bounds", () => {
    expect(parseCycleEnvironment({
      GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "5",
      GITHUB_CONNECTION_MAX_INSTALLATIONS: "3",
      GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "4",
      GITHUB_CONNECTION_TIME_BUDGET_MS: "30000",
    })).toEqual({ maximumWebhookDeliveries: 5, maximumInstallations: 3, maximumSlackDeliveries: 4, timeBudgetMs: 30000 });
  });

  it.each([
    ["zero deliveries", { GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "0" }],
    ["oversized deliveries", { GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "101" }],
    ["zero Slack deliveries", { GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "0" }],
    ["oversized Slack deliveries", { GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "26" }],
    ["fractional Slack deliveries", { GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "2.5" }],
    ["non-numeric Slack deliveries", { GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "soon" }],
    ["fractional installations", { GITHUB_CONNECTION_MAX_INSTALLATIONS: "2.5" }],
    ["negative budget", { GITHUB_CONNECTION_TIME_BUDGET_MS: "-1" }],
    ["oversized budget", { GITHUB_CONNECTION_TIME_BUDGET_MS: "300001" }],
    ["non-numeric budget", { GITHUB_CONNECTION_TIME_BUDGET_MS: "soon" }],
  ])("rejects %s without starting work", (_label, env) => {
    expect(() => parseCycleEnvironment(env)).toThrow("GitHub connection cycle configuration is invalid");
  });

  it("summarises only counts and identifiers for logs", () => {
    const summary = summariseCycleForLog("11111111-1111-4111-8111-111111111111", {
      executionId: "11111111-1111-4111-8111-111111111111",
      webhookDeliveriesClaimed: 2,
      installationsClaimed: 1,
      healthy: 1,
      retrying: 0,
      actionRequired: 0,
      recovered: 0,
      ownershipLost: 0,
    });
    expect(summary).toContain("11111111-1111-4111-8111-111111111111");
    expect(summary).toContain("healthy=1");
    expect(summary).not.toContain("secret");
  });

  it("maps clean, interrupted and failed cycles to exit codes", () => {
    expect(exitCodeForCycle(null)).toBe(0);
    expect(exitCodeForCycle(new Error("GitHub connection cycle exceeded its time budget"))).toBe(1);
    expect(exitCodeForCycle(new Error("GitHub connection cycle was aborted"))).toBe(1);
    expect(exitCodeForCycle(new Error("anything else"))).toBe(1);
    expect(exitCodeForCycle(null, 1)).toBe(1);
  });

  it("includes only Slack delivery counts in the safe summary", () => {
    const summary = summariseCycleForLog("11111111-1111-4111-8111-111111111111", {
      executionId: "11111111-1111-4111-8111-111111111111",
      webhookDeliveriesClaimed: 0,
      installationsClaimed: 0,
      healthy: 0,
      retrying: 0,
      actionRequired: 0,
      recovered: 0,
      ownershipLost: 0,
    }, { claimed: 2, delivered: 1, failed: 1 });
    expect(summary).toContain("slackClaimed=2 slackDelivered=1 slackFailed=1");
    expect(summary).not.toContain("fixture-secret");
  });

  function runtimeDependencies(events: string[], signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal }, overrides: Record<string, unknown> = {}) {
    const runCycle = async (_deps: unknown, input: { signal?: AbortSignal }) => {
      events.push("cycle");
      signalRef.signal = input.signal;
      signalRef.cycleSignal = input.signal;
      return {
        executionId: "11111111-1111-4111-8111-111111111111",
        webhookDeliveriesClaimed: 0,
        installationsClaimed: 0,
        healthy: 1,
        retrying: 0,
        actionRequired: 0,
        recovered: 0,
        ownershipLost: 0,
      };
    };
    return {
      getConfig: () => ({
        appId: "1",
        appSlug: "fixture",
        clientId: "client",
        clientSecret: "secret",
        privateKey: "private",
        webhookSecret: "webhook",
        allowedAccountId: 1,
        allowedAccountType: "Organization" as const,
      }),
      createServiceClient: () => ({
        rpc: async () => ({ data: [], error: null }),
        from: () => ({
          select: () => {
            const single = async () => ({ data: null, error: null });
            const query = Object.assign(Promise.resolve({ data: [], error: null }), { single });
            return { eq: () => query, single };
          },
        }),
      }),
      createAppJwt: async () => "jwt",
      createInstallationToken: async () => ({ token: "token", expiresAt: "2026-09-20T00:00:00.000Z" }),
      readInstallationSnapshot: async () => ({}) as never,
      runCycle,
      now: () => new Date("2026-09-20T00:00:00.000Z"),
      drainSlackDeliveries: async (_service: unknown, batchSize: number, signal: AbortSignal) => {
        events.push(`slack:${batchSize}`);
        signalRef.signal = signal;
        signalRef.drainSignal = signal;
        return { claimed: 1, delivered: 1, failed: 0 };
      },
      ...overrides,
    };
  }

  it("runs the connection-only Slack drain after reconciliation with one shared deadline signal", async () => {
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const result = await runGitHubConnectionReconcile({
      environment: { GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "7" },
      executionId: "11111111-1111-4111-8111-111111111111",
      signal: AbortSignal.timeout(5_000),
      dependencies: runtimeDependencies(events, signalRef),
    });
    expect(events).toEqual(["cycle", "slack:7"]);
    expect(result.summary).toEqual(expect.objectContaining({ slackClaimed: 1, slackDelivered: 1, slackFailed: 0 }));
    expect(signalRef.signal).toBeDefined();
    expect(signalRef.cycleSignal).toBe(signalRef.drainSignal);
  });

  it("does not report success when the shared deadline expires during Slack draining", async () => {
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const controller = new AbortController();
    await expect(runGitHubConnectionReconcile({
      environment: { GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "1" },
      executionId: "11111111-1111-4111-8111-111111111111",
      signal: controller.signal,
      dependencies: runtimeDependencies(events, signalRef, {
        drainSlackDeliveries: async (_service, _batchSize, signal) => {
          signalRef.drainSignal = signal;
          controller.abort(new Error("deadline expired during Slack drain"));
          return { claimed: 1, delivered: 1, failed: 0 };
        },
      }),
    })).rejects.toThrow("deadline expired during Slack drain");
  });

  it("returns CLI failure after recording a failed Slack delivery summary", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const exitCode = await runGitHubConnectionReconcileCli({
      environment: {},
      dependencies: runtimeDependencies(events, signalRef, {
        drainSlackDeliveries: async () => ({ claimed: 1, delivered: 0, failed: 1 }),
      }),
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    });
    expect(exitCode).toBe(1);
    expect(stdout.join("")).toContain("slackClaimed=1 slackDelivered=0 slackFailed=1");
    expect(stderr).toEqual([]);
  });

  it("returns the redacted failure line when Slack draining throws", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const exitCode = await runGitHubConnectionReconcileCli({
      environment: {},
      dependencies: runtimeDependencies(events, signalRef, {
        drainSlackDeliveries: async () => { throw new Error("webhook fixture secret"); },
      }),
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    });
    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toMatch(/^github-connection-reconcile execution=[0-9a-f-]+ failed\n$/);
    expect(stderr.join("")).not.toContain("webhook fixture secret");
  });
});
