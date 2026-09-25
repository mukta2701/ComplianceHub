// @vitest-environment node
import { createServer } from "node:http";

import { describe, expect, it, vi } from "vitest";

import {
  exitCodeForCycle,
  parseCycleEnvironment,
  runGitHubConnectionReconcile,
  runGitHubConnectionReconcileCli,
  summariseCycleForLog,
  type GitHubConnectionReconcileRuntimeDependencies,
} from "./github-connection-reconcile";

describe("github-connection-reconcile entry point", () => {
  async function listen(server: ReturnType<typeof createServer>): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port");
    return address.port;
  }

  async function close(server: ReturnType<typeof createServer>): Promise<void> {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

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
    expect(exitCodeForCycle(null, 0, 1)).toBe(1);
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

  function runtimeDependencies(
    events: string[],
    signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal },
    overrides: Partial<GitHubConnectionReconcileRuntimeDependencies> = {},
  ) {
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

  it("finalises a suspended installation before attempting to mint an installation token", async () => {
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const createInstallationToken = vi.fn().mockRejectedValue(new Error("must not mint for suspension"));
    const readInstallationSnapshot = vi.fn().mockImplementation(async (input: {
      provideInstallationToken?: () => Promise<string>;
    }) => {
      expect(input.provideInstallationToken).toEqual(expect.any(Function));
      return {
        installationId: 77,
        account: { id: 99, login: "Adtecher", type: "Organization" as const },
        repositorySelection: "selected" as const,
        permissions: {
          actions: "read",
          administration: "read",
          metadata: "read",
          secret_scanning_alerts: "read",
          security_events: "read",
          vulnerability_alerts: "read",
        },
        suspendedAt: "2026-09-20T21:43:00.000Z",
        repositories: [],
      };
    });
    const rpc = vi.fn().mockResolvedValue({ data: "opened", error: null });
    const result = await runGitHubConnectionReconcile({
      environment: {},
      executionId: "11111111-1111-4111-8111-111111111111",
      dependencies: runtimeDependencies(events, signalRef, {
        createInstallationToken,
        readInstallationSnapshot,
        createServiceClient: () => ({
          rpc,
          from: () => ({
            select: () => {
              const single = async () => ({ data: null, error: null });
              const query = Object.assign(Promise.resolve({ data: [], error: null }), { single });
              return { eq: () => query, single };
            },
          }),
        }),
        runCycle: async (cycleDependencies, input) => {
          const reconciliation = await cycleDependencies.reconcileClaim({
            runId: "33333333-3333-4333-8333-333333333333",
            installationUuid: "22222222-2222-4222-8222-222222222222",
            providerInstallationId: 77,
            organisationId: "55555555-5555-4555-8555-555555555555",
            previousHealth: "healthy",
            consecutiveFailures: 0,
            expectedAccount: { id: 99, login: "Adtecher", type: "Organization" },
          });
          expect(reconciliation.decision).toMatchObject({
            health: "owner_action_required",
            diagnostic: "installation_suspended",
            openIncident: true,
          });
          return {
            executionId: input.executionId,
            webhookDeliveriesClaimed: 0,
            installationsClaimed: 1,
            healthy: 0,
            retrying: 0,
            actionRequired: 1,
            recovered: 0,
            ownershipLost: 0,
          };
        },
        drainSlackDeliveries: async () => ({ claimed: 0, delivered: 0, failed: 0 }),
      }),
    });
    expect(result.summary).toMatchObject({ actionRequired: 1, ownershipLost: 0 });
    expect(createInstallationToken).not.toHaveBeenCalled();
    expect(readInstallationSnapshot).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("finalize_github_connection_reconciliation_server", {
      target_run_id: "33333333-3333-4333-8333-333333333333",
      target_worker_id: "11111111-1111-4111-8111-111111111111",
      target_outcome: "action_required",
      target_diagnostic_code: "installation_suspended",
      target_next_attempt_at: null,
      target_repository_snapshot: null,
    });
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

  it("cancels a stalled initial Supabase claim at the command deadline", async () => {
    const requests: string[] = [];
    let disconnectedBeforeResponse = false;
    let disconnectedResolve: () => void = () => undefined;
    const disconnected = new Promise<void>((resolve) => { disconnectedResolve = resolve; });
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      request.socket.once("close", () => {
        disconnectedBeforeResponse = !response.headersSent;
        disconnectedResolve();
      });
      setTimeout(() => {
        if (!response.destroyed) response.end("[]");
      }, 400);
    });
    const port = await listen(server);
    const stderr: string[] = [];
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${port}`);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictional-service-role");
    const startedAt = Date.now();
    try {
      const exitCode = await runGitHubConnectionReconcileCli({
        environment: {
          GITHUB_CONNECTION_TIME_BUDGET_MS: "100",
          GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "1",
          GITHUB_CONNECTION_MAX_INSTALLATIONS: "1",
          GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "1",
        },
        dependencies: {
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
          createAppJwt: async () => "jwt",
        },
        stderr: (value) => stderr.push(value),
      });
      const elapsedMs = Date.now() - startedAt;
      expect(exitCode).toBe(1);
      expect(elapsedMs).toBeLessThan(350);
      expect(requests).toContain("/rest/v1/rpc/claim_github_connection_webhook_deliveries_server");
      await disconnected;
      expect(disconnectedBeforeResponse).toBe(true);
      expect(stderr).toEqual([expect.stringMatching(/^github-connection-reconcile execution=[0-9a-f-]+ failed\n$/)]);
      expect(stderr.join("")).not.toContain("fictional-service-role");
    } finally {
      vi.unstubAllEnvs();
      await close(server);
    }
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

  it("returns CLI failure when reconciliation loses transition ownership", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const exitCode = await runGitHubConnectionReconcileCli({
      environment: {},
      dependencies: runtimeDependencies(events, signalRef, {
        runCycle: async (_dependencies, input) => ({
          executionId: input.executionId,
          webhookDeliveriesClaimed: 0,
          installationsClaimed: 1,
          healthy: 0,
          retrying: 0,
          actionRequired: 1,
          recovered: 0,
          ownershipLost: 1,
        }),
      }),
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    });
    expect(exitCode).toBe(1);
    expect(stdout.join("")).toContain("ownershipLost=1");
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

  it("inventories all App-accessible repositories when only one is Owner-selected", async () => {
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const createInstallationToken = vi.fn().mockResolvedValue({ token: "x", expiresAt: "2026-09-20T00:00:00.000Z" });
    const readInstallationSnapshot = vi.fn().mockImplementation(async (input: {
      installationId: number;
      provideInstallationToken?: () => Promise<string>;
    }) => {
      // Reconciliation inventory must use an unrestricted installation token so
      // GET /installation/repositories sees every App-accessible repository.
      const token = await input.provideInstallationToken?.();
      expect(token).toBe("x");
      return {
        installationId: 77,
        account: { id: 99, login: "Adtecher", type: "Organization" as const },
        repositorySelection: "selected" as const,
        permissions: {
          actions: "read",
          administration: "read",
          metadata: "read",
          secret_scanning_alerts: "read",
          security_events: "read",
          vulnerability_alerts: "read",
        },
        suspendedAt: null,
        repositories: [
          {
            id: 101, owner: "Adtecher", name: "repo-101", fullName: "Adtecher/repo-101",
            htmlUrl: "https://github.com/Adtecher/repo-101", visibility: "private" as const,
            archived: false, defaultBranch: "main",
          },
          {
            id: 102, owner: "Adtecher", name: "repo-102", fullName: "Adtecher/repo-102",
            htmlUrl: "https://github.com/Adtecher/repo-102", visibility: "private" as const,
            archived: false, defaultBranch: "main",
          },
        ],
      };
    });
    const rpc = vi.fn().mockResolvedValue({ data: "none", error: null });
    const from = () => ({
      select: (columns: string) => {
        const single = async () => ({ data: null, error: null });
        // Owner selects only repo 101; repo 102 remains App-accessible but unselected.
        // Stored inventory keeps both App-scope rows.
        const data = columns.includes("selected")
          ? [
            { provider_repository_id: 101, selected: true, available: true },
            { provider_repository_id: 102, selected: false, available: true },
          ]
          : [
            { provider_repository_id: 101, full_name: "Adtecher/repo-101" },
            { provider_repository_id: 102, full_name: "Adtecher/repo-102" },
          ];
        const query = Object.assign(Promise.resolve({ data, error: null }), { single });
        return { eq: () => query, single };
      },
    });
    const result = await runGitHubConnectionReconcile({
      environment: {},
      executionId: "11111111-1111-4111-8111-111111111111",
      dependencies: runtimeDependencies(events, signalRef, {
        createInstallationToken,
        readInstallationSnapshot,
        createServiceClient: () => ({ rpc, from }) as never,
        runCycle: async (cycleDependencies, input) => {
          const reconciliation = await cycleDependencies.reconcileClaim({
            runId: "33333333-3333-4333-8333-333333333333",
            installationUuid: "22222222-2222-4222-8222-222222222222",
            providerInstallationId: 77,
            organisationId: "55555555-5555-4555-8555-555555555555",
            previousHealth: "healthy",
            consecutiveFailures: 0,
            expectedAccount: { id: 99, login: "Adtecher", type: "Organization" },
          });
          expect(reconciliation.decision).toMatchObject({ health: "healthy", openIncident: false });
          expect(reconciliation.repositoriesSeen).toBe(2);
          return {
            executionId: input.executionId,
            webhookDeliveriesClaimed: 0,
            installationsClaimed: 1,
            healthy: 1,
            retrying: 0,
            actionRequired: 0,
            recovered: 0,
            ownershipLost: 0,
          };
        },
        drainSlackDeliveries: async () => ({ claimed: 0, delivered: 0, failed: 0 }),
      }),
    });
    expect(result.summary).toMatchObject({ healthy: 1, actionRequired: 0 });
    // Inventory token must not be restricted to the Owner-selected subset
    // and must use the narrow metadata-read inventory purpose.
    expect(createInstallationToken).toHaveBeenCalledTimes(1);
    expect(createInstallationToken).toHaveBeenCalledWith(expect.objectContaining({ purpose: "inventory" }));
    expect(createInstallationToken).toHaveBeenCalledWith(expect.not.objectContaining({ repositoryIds: expect.anything() }));
    expect(rpc).toHaveBeenCalledWith("finalize_github_connection_reconciliation_server", expect.objectContaining({
      target_outcome: "success",
    }));
  });

  it("succeeds with zero Owner-selected repositories when App access remains", async () => {
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const createInstallationToken = vi.fn().mockResolvedValue({ token: "x", expiresAt: "2026-09-20T00:00:00.000Z" });
    const readInstallationSnapshot = vi.fn().mockImplementation(async (input: {
      provideInstallationToken?: () => Promise<string>;
    }) => {
      const token = await input.provideInstallationToken?.();
      expect(token).toBe("x");
      return {
        installationId: 77,
        account: { id: 99, login: "Adtecher", type: "Organization" as const },
        repositorySelection: "selected" as const,
        permissions: {
          actions: "read",
          administration: "read",
          metadata: "read",
          secret_scanning_alerts: "read",
          security_events: "read",
          vulnerability_alerts: "read",
        },
        suspendedAt: null,
        repositories: [
          {
            id: 102, owner: "Adtecher", name: "repo-102", fullName: "Adtecher/repo-102",
            htmlUrl: "https://github.com/Adtecher/repo-102", visibility: "private" as const,
            archived: false, defaultBranch: "main",
          },
        ],
      };
    });
    const rpc = vi.fn().mockResolvedValue({ data: "none", error: null });
    const from = () => ({
      select: (columns: string) => {
        const single = async () => ({ data: null, error: null });
        const data = columns.includes("selected")
          ? [{ provider_repository_id: 102, selected: false, available: true }]
          : [{ provider_repository_id: 102, full_name: "Adtecher/repo-102" }];
        const query = Object.assign(Promise.resolve({ data, error: null }), { single });
        return { eq: () => query, single };
      },
    });
    const result = await runGitHubConnectionReconcile({
      environment: {},
      executionId: "11111111-1111-4111-8111-111111111111",
      dependencies: runtimeDependencies(events, signalRef, {
        createInstallationToken,
        readInstallationSnapshot,
        createServiceClient: () => ({ rpc, from }) as never,
        runCycle: async (cycleDependencies, input) => {
          const reconciliation = await cycleDependencies.reconcileClaim({
            runId: "33333333-3333-4333-8333-333333333333",
            installationUuid: "22222222-2222-4222-8222-222222222222",
            providerInstallationId: 77,
            organisationId: "55555555-5555-4555-8555-555555555555",
            previousHealth: "healthy",
            consecutiveFailures: 0,
            expectedAccount: { id: 99, login: "Adtecher", type: "Organization" },
          });
          expect(reconciliation.decision).toMatchObject({ health: "healthy", openIncident: false });
          return {
            executionId: input.executionId,
            webhookDeliveriesClaimed: 0,
            installationsClaimed: 1,
            healthy: 1,
            retrying: 0,
            actionRequired: 0,
            recovered: 0,
            ownershipLost: 0,
          };
        },
        drainSlackDeliveries: async () => ({ claimed: 0, delivered: 0, failed: 0 }),
      }),
    });
    expect(result.summary).toMatchObject({ healthy: 1 });
    expect(createInstallationToken).toHaveBeenCalledTimes(1);
    expect(createInstallationToken).toHaveBeenCalledWith(expect.objectContaining({ purpose: "inventory" }));
    expect(createInstallationToken).toHaveBeenCalledWith(expect.not.objectContaining({ repositoryIds: expect.anything() }));
  });

  it("still reports partial when real App access is removed", async () => {
    const events: string[] = [];
    const signalRef: { signal?: AbortSignal; cycleSignal?: AbortSignal; drainSignal?: AbortSignal } = {};
    const createInstallationToken = vi.fn().mockResolvedValue({ token: "x", expiresAt: "2026-09-20T00:00:00.000Z" });
    const readInstallationSnapshot = vi.fn().mockResolvedValue({
      installationId: 77,
      account: { id: 99, login: "Adtecher", type: "Organization" as const },
      repositorySelection: "selected" as const,
      permissions: {
        actions: "read",
        administration: "read",
        metadata: "read",
        secret_scanning_alerts: "read",
        security_events: "read",
        vulnerability_alerts: "read",
      },
      suspendedAt: null,
      repositories: [
        {
          id: 101, owner: "Adtecher", name: "repo-101", fullName: "Adtecher/repo-101",
          htmlUrl: "https://github.com/Adtecher/repo-101", visibility: "private" as const,
          archived: false, defaultBranch: "main",
        },
      ],
    });
    const rpc = vi.fn().mockResolvedValue({ data: "opened", error: null });
    const from = () => ({
      select: (columns: string) => {
        const single = async () => ({ data: null, error: null });
        const data = columns.includes("selected")
          ? [
            { provider_repository_id: 101, selected: true, available: true },
            { provider_repository_id: 102, selected: true, available: true },
          ]
          : [
            { provider_repository_id: 101, full_name: "Adtecher/repo-101" },
            { provider_repository_id: 102, full_name: "Adtecher/repo-102" },
          ];
        const query = Object.assign(Promise.resolve({ data, error: null }), { single });
        return { eq: () => query, single };
      },
    });
    await runGitHubConnectionReconcile({
      environment: {},
      executionId: "11111111-1111-4111-8111-111111111111",
      dependencies: runtimeDependencies(events, signalRef, {
        createInstallationToken,
        readInstallationSnapshot,
        createServiceClient: () => ({ rpc, from }) as never,
        runCycle: async (cycleDependencies, input) => {
          const reconciliation = await cycleDependencies.reconcileClaim({
            runId: "33333333-3333-4333-8333-333333333333",
            installationUuid: "22222222-2222-4222-8222-222222222222",
            providerInstallationId: 77,
            organisationId: "55555555-5555-4555-8555-555555555555",
            previousHealth: "healthy",
            consecutiveFailures: 0,
            expectedAccount: { id: 99, login: "Adtecher", type: "Organization" },
          });
          expect(reconciliation.decision).toMatchObject({ health: "partially_unavailable", openIncident: true });
          return {
            executionId: input.executionId,
            webhookDeliveriesClaimed: 0,
            installationsClaimed: 1,
            healthy: 0,
            retrying: 0,
            actionRequired: 0,
            recovered: 0,
            ownershipLost: 0,
          };
        },
        drainSlackDeliveries: async () => ({ claimed: 0, delivered: 0, failed: 0 }),
      }),
    });
    expect(rpc).toHaveBeenCalledWith("finalize_github_connection_reconciliation_server", expect.objectContaining({
      target_outcome: "partial",
      target_diagnostic_code: "repository_unavailable",
    }));
  });
});
