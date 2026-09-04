import { describe, expect, it, vi } from "vitest";
import {
  configureJiraWebhookProjects,
  createSupabaseJiraWebhookLifecycleStore,
  disconnectJiraWebhook,
  drainJiraWebhookCleanup,
  ensureJiraWebhook,
  reconcileDueJiraWebhooks,
  type JiraWebhookConfiguration,
  type JiraWebhookLifecycleStore,
} from "./jira-webhook-lifecycle";
import { JIRA_WEBHOOK_EVENTS, buildJiraWebhookJql, type JiraOAuthGateway } from "./jira-oauth";

const organisationId = "70000000-0000-4000-8000-000000000001";
const userId = "70000000-0000-4000-8000-000000000002";
const connectionId = "70000000-0000-4000-8000-000000000003";
const cloudId = "70000000-0000-4000-8000-000000000004";
const accessToken = "jira-access-credential";
const callbackBaseUrl = "https://compliance.example";
const candidateCleanupId = "70000000-0000-4000-8000-000000000090";
const candidateOwnershipToken = "70000000-0000-4000-8000-000000000091";

const configuration: JiraWebhookConfiguration = {
  organisationId,
  connectionId,
  cloudId,
  generation: 3,
  webhookId: "71001",
  webhookExpiresAt: "2026-08-01T00:00:00.000Z",
  callbackHash: "a".repeat(64),
};

const projects = [
  { externalId: "101", displayName: "SEC · Security", baseUrl: "https://acme.atlassian.net", cloudId, projectKey: "SEC" },
  { externalId: "102", displayName: "ENG · Engineering", baseUrl: "https://acme.atlassian.net", cloudId, projectKey: "ENG" },
];

function gateway(overrides: Partial<JiraOAuthGateway> = {}): JiraOAuthGateway {
  return {
    exchangeAuthorizationCode: vi.fn(),
    refreshAuthorization: vi.fn(),
    listAccessibleResources: vi.fn(),
    listProjects: vi.fn(),
    listDynamicWebhooks: vi.fn(async () => []),
    registerDynamicWebhook: vi.fn(async () => ({ id: "71002" })),
    refreshDynamicWebhook: vi.fn(async () => ({ expiresAt: "2026-08-20T00:00:00.000Z" })),
    deleteDynamicWebhook: vi.fn(async () => undefined),
    ...overrides,
  };
}

function store(overrides: Partial<JiraWebhookLifecycleStore> = {}): JiraWebhookLifecycleStore {
  return {
    commitConfiguration: vi.fn(async () => true),
    replaceMetadata: vi.fn(async () => true),
    refreshExpiry: vi.fn(async () => true),
    listDue: vi.fn(async () => []),
    readProjectKeys: vi.fn(async () => ["ENG", "SEC"]),
    disconnect: vi.fn(async () => ({ webhookId: "71001" })),
    prepareCandidate: vi.fn(async () => ({ cleanupId: candidateCleanupId, ownershipToken: candidateOwnershipToken })),
    recordCandidate: vi.fn(async () => true),
    readCandidateState: vi.fn(async (): Promise<"prepared"> => "prepared"),
    acknowledgeCleanup: vi.fn(async () => true),
    claimCleanup: vi.fn(async () => null),
    completeCleanup: vi.fn(async () => true),
    failCleanup: vi.fn(async () => true),
    observeCleanupAbsent: vi.fn(async () => false),
    ...overrides,
  };
}

describe("Jira dynamic webhook lifecycle", () => {
  it("uses only narrow lifecycle RPCs and never sends a raw callback token", async () => {
    const rpc = vi.fn(async (name: string): Promise<{ data: unknown; error: unknown }> => ({
      data: name === "list_due_jira_webhook_configurations"
        ? [{
          organisation_id: organisationId,
          connection_id: connectionId,
          cloud_id: cloudId,
          webhook_generation: 3,
          webhook_id: "71001",
          webhook_expires_at: "2026-08-01T00:00:00.000Z",
          callback_hash: "a".repeat(64),
        }]
        : name === "read_jira_webhook_project_keys"
          ? ["SEC", "ENG"]
          : name === "disconnect_jira_oauth"
            ? "71001"
            : true,
      error: null,
    }));
    const persistence = createSupabaseJiraWebhookLifecycleStore({ rpc });
    await persistence.commitConfiguration({
      organisationId,
      userId,
      connectionId,
      expectedGeneration: 3,
      expectedWebhookId: "71001",
      candidateCleanupId,
      candidateOwnershipToken,
      newWebhookId: "71002",
      newWebhookExpiresAt: "2026-08-12T00:00:00.000Z",
      newCallbackHash: "b".repeat(64),
      verifiedProjects: projects,
    });
    await persistence.replaceMetadata({
      connectionId,
      expectedGeneration: 4,
      expectedWebhookId: "71002",
      candidateCleanupId,
      candidateOwnershipToken,
      newWebhookId: "71003",
      newWebhookExpiresAt: "2026-08-13T00:00:00.000Z",
      newCallbackHash: "c".repeat(64),
    });
    await persistence.refreshExpiry({
      connectionId, expectedGeneration: 5, expectedWebhookId: "71003",
      newWebhookExpiresAt: "2026-08-14T00:00:00.000Z",
    });
    await expect(persistence.listDue(20)).resolves.toHaveLength(1);
    await expect(persistence.readProjectKeys(connectionId, 3)).resolves.toEqual(["ENG", "SEC"]);
    await expect(persistence.disconnect({ organisationId, userId, connectionId }))
      .resolves.toEqual({ webhookId: "71001" });
    const serialized = JSON.stringify(rpc.mock.calls);
    expect(serialized).not.toContain("R".repeat(43));
    expect(serialized).not.toContain("accessToken");
  });

  it("registers at the provider before atomically committing projects and metadata", async () => {
    const provider = gateway();
    const persistence = store();

    await expect(configureJiraWebhookProjects({
      gateway: provider,
      store: persistence,
      accessToken,
      configuration,
      organisationId,
      userId,
      callbackBaseUrl,
      verifiedProjects: projects,
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    })).resolves.toEqual({ webhookId: "71002", generation: 4 });

    expect(provider.registerDynamicWebhook).toHaveBeenCalledWith(expect.objectContaining({
      accessToken,
      cloudId,
      callbackUrl: expect.stringMatching(/^https:\/\/compliance\.example\/api\/webhooks\/jira\/[A-Za-z0-9_-]{43}$/),
      projectKeys: ["ENG", "SEC"],
    }));
    expect(persistence.commitConfiguration).toHaveBeenCalledAfter(vi.mocked(provider.registerDynamicWebhook));
    expect(persistence.commitConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      organisationId,
      userId,
      connectionId,
      expectedGeneration: 3,
      expectedWebhookId: "71001",
      newWebhookId: "71002",
      newCallbackHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      verifiedProjects: projects,
    }));
    expect(JSON.stringify(vi.mocked(persistence.commitConfiguration).mock.calls)).not.toMatch(/api\/webhooks\/jira\/[A-Za-z0-9_-]{43}/);
    expect(provider.deleteDynamicWebhook).toHaveBeenCalledWith({ accessToken, cloudId, webhookId: "71001" });
    expect(provider.deleteDynamicWebhook).toHaveBeenCalledAfter(vi.mocked(persistence.commitConfiguration));
    expect(persistence.acknowledgeCleanup).toHaveBeenCalledWith({
      organisationId, cloudId, webhookId: "71001",
    });
  });

  it("deletes only the new candidate when the CAS loses or persistence fails", async () => {
    for (const commitConfiguration of [
      vi.fn(async () => false),
      vi.fn(async () => { throw new Error("database unavailable"); }),
    ]) {
      const provider = gateway();
      await expect(configureJiraWebhookProjects({
        gateway: provider,
        store: store({ commitConfiguration }),
        accessToken,
        configuration,
        organisationId,
        userId,
        callbackBaseUrl,
        verifiedProjects: projects,
      })).rejects.toThrow("Jira projects could not be saved");
      expect(provider.deleteDynamicWebhook).toHaveBeenCalledTimes(1);
      expect(provider.deleteDynamicWebhook).toHaveBeenCalledWith({ accessToken, cloudId, webhookId: "71002" });
      expect(provider.deleteDynamicWebhook).not.toHaveBeenCalledWith(expect.objectContaining({ webhookId: "71001" }));
    }
  });

  it("prepares candidate cleanup before POST and keeps the recorded intent when deletion fails", async () => {
    const provider = gateway({ deleteDynamicWebhook: vi.fn(async () => { throw new Error("provider down"); }) });
    const persistence = store({ commitConfiguration: vi.fn(async () => false) });
    await expect(configureJiraWebhookProjects({
      gateway: provider, store: persistence, accessToken, configuration,
      organisationId, userId, callbackBaseUrl, verifiedProjects: projects,
    })).rejects.toThrow("Jira projects could not be saved");
    expect(persistence.prepareCandidate).toHaveBeenCalledBefore(vi.mocked(provider.registerDynamicWebhook));
    expect(persistence.prepareCandidate).toHaveBeenCalledWith(expect.objectContaining({
      callbackOrigin: callbackBaseUrl,
    }));
    expect(persistence.recordCandidate).toHaveBeenCalledWith(
      candidateCleanupId, candidateOwnershipToken, "71002",
    );
    expect(persistence.acknowledgeCleanup).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(persistence.prepareCandidate).mock.calls)).not.toContain(accessToken);
  });

  it("does not delete an ambiguously committed candidate when commit and readback both fail", async () => {
    const provider = gateway();
    const persistence = store({
      commitConfiguration: vi.fn(async () => { throw new Error("response lost"); }),
      readCandidateState: vi.fn(async () => { throw new Error("readback unavailable"); }),
    });

    await expect(configureJiraWebhookProjects({
      gateway: provider, store: persistence, accessToken, configuration,
      organisationId, userId, callbackBaseUrl, verifiedProjects: projects,
    })).rejects.toThrow("Jira projects could not be saved");

    expect(provider.deleteDynamicWebhook).not.toHaveBeenCalled();
    expect(persistence.acknowledgeCleanup).not.toHaveBeenCalled();
  });

  it("treats a promoted candidate as committed when the commit response is lost", async () => {
    const provider = gateway();
    const persistence = store({
      commitConfiguration: vi.fn(async () => { throw new Error("response lost"); }),
      readCandidateState: vi.fn(async (): Promise<"promoted"> => "promoted"),
    });

    await expect(configureJiraWebhookProjects({
      gateway: provider, store: persistence, accessToken, configuration,
      organisationId, userId, callbackBaseUrl, verifiedProjects: projects,
    })).resolves.toEqual({ webhookId: "71002", generation: 4 });

    expect(provider.deleteDynamicWebhook).toHaveBeenCalledTimes(1);
    expect(provider.deleteDynamicWebhook).toHaveBeenCalledWith({
      accessToken, cloudId, webhookId: "71001",
    });
  });

  it("refuses registration at the provider quota before preparing a candidate", async () => {
    const provider = gateway({
      listDynamicWebhooks: vi.fn(async () => Array.from({ length: 5 }, (_, index) => ({
        id: String(72000 + index), jqlFilter: "project = SEC", events: [...JIRA_WEBHOOK_EVENTS],
        expiresAt: "2026-08-01T00:00:00.000Z", url: `${callbackBaseUrl}/unrelated/${index}`,
      }))),
    });
    const persistence = store();

    await expect(configureJiraWebhookProjects({
      gateway: provider, store: persistence, accessToken, configuration,
      organisationId, userId, callbackBaseUrl, verifiedProjects: projects,
    })).rejects.toThrow("Jira webhook could not be registered");

    expect(persistence.prepareCandidate).not.toHaveBeenCalled();
    expect(provider.registerDynamicWebhook).not.toHaveBeenCalled();
  });

  it("rejects an exhausted webhook generation before creating a provider resource", async () => {
    const provider = gateway();
    await expect(configureJiraWebhookProjects({
      gateway: provider,
      store: store(),
      accessToken,
      configuration: { ...configuration, generation: 2_147_483_646 },
      organisationId,
      userId,
      callbackBaseUrl,
      verifiedProjects: projects,
    })).rejects.toThrow("Jira webhook generation is exhausted");
    expect(provider.registerDynamicWebhook).not.toHaveBeenCalled();
  });

  it("verifies provider existence, callback hash, JQL, and events before refreshing", async () => {
    const rawToken = "A".repeat(43);
    const current = { ...configuration, callbackHash: "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a" };
    const firstListing = [{
        id: "71001",
        jqlFilter: buildJiraWebhookJql(["SEC", "ENG"]),
        events: [...JIRA_WEBHOOK_EVENTS],
        expiresAt: "2026-08-01T00:00:00.000Z",
        url: `${callbackBaseUrl}/api/webhooks/jira/${rawToken}`,
    }];
    const provider = gateway({
      listDynamicWebhooks: vi.fn()
        .mockResolvedValueOnce(firstListing)
        .mockResolvedValueOnce([{ ...firstListing[0], expiresAt: "2026-08-21T00:00:00.000Z" }]),
    });
    const persistence = store();

    await expect(ensureJiraWebhook({
      gateway: provider,
      store: persistence,
      accessToken,
      configuration: current,
      projectKeys: ["SEC", "ENG"],
      callbackBaseUrl,
    })).resolves.toEqual({ status: "refreshed", generation: 3 });
    expect(provider.refreshDynamicWebhook).toHaveBeenCalledWith({ accessToken, cloudId, webhookId: "71001" });
    expect(persistence.refreshExpiry).toHaveBeenCalledWith({
      connectionId, expectedGeneration: 3, expectedWebhookId: "71001",
      newWebhookExpiresAt: "2026-08-21T00:00:00.000Z",
    });
    expect(provider.registerDynamicWebhook).not.toHaveBeenCalled();
  });

  it("re-lists after refresh and replaces when the provider deletes the webhook in the race", async () => {
    const rawToken = "A".repeat(43);
    const current = { ...configuration, callbackHash: "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a" };
    const listed = [{
      id: "71001", jqlFilter: buildJiraWebhookJql(["SEC", "ENG"]),
      events: [...JIRA_WEBHOOK_EVENTS], expiresAt: "2026-08-01T00:00:00.000Z",
      url: `${callbackBaseUrl}/api/webhooks/jira/${rawToken}`,
    }];
    const provider = gateway({
      listDynamicWebhooks: vi.fn()
        .mockResolvedValueOnce(listed)
        .mockResolvedValueOnce([]),
    });
    const persistence = store();

    await expect(ensureJiraWebhook({
      gateway: provider, store: persistence, accessToken,
      configuration: current, projectKeys: ["SEC", "ENG"], callbackBaseUrl,
    })).resolves.toEqual({ status: "replaced", generation: 4 });
    expect(provider.refreshDynamicWebhook).toHaveBeenCalledOnce();
    expect(persistence.refreshExpiry).not.toHaveBeenCalled();
    expect(provider.registerDynamicWebhook).toHaveBeenCalledOnce();
  });

  it.each([
    `https://user:pass@compliance.example/api/webhooks/jira/${"A".repeat(43)}`,
    `https://compliance.example:8443/api/webhooks/jira/${"A".repeat(43)}`,
    `https://compliance.example/api/webhooks/jira/${"A".repeat(43)}?query=bad`,
  ])("replaces a provider callback URL with origin anomalies: %s", async (url) => {
    const current = { ...configuration, callbackHash: "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a" };
    const provider = gateway({
      listDynamicWebhooks: vi.fn(async () => [{
        id: "71001",
        jqlFilter: buildJiraWebhookJql(["ENG", "SEC"]),
        events: [...JIRA_WEBHOOK_EVENTS],
        expiresAt: "2026-08-01T00:00:00.000Z",
        url,
      }]),
    });
    await expect(ensureJiraWebhook({
      gateway: provider,
      store: store(),
      accessToken,
      configuration: current,
      projectKeys: ["ENG", "SEC"],
      callbackBaseUrl,
    })).resolves.toMatchObject({ status: "replaced" });
    expect(provider.refreshDynamicWebhook).not.toHaveBeenCalled();
  });

  it("replaces a missing or mismatched provider webhook instead of trusting refresh", async () => {
    const provider = gateway({ listDynamicWebhooks: vi.fn(async () => []) });
    const persistence = store();
    await expect(ensureJiraWebhook({
      gateway: provider,
      store: persistence,
      accessToken,
      configuration,
      projectKeys: ["ENG", "SEC"],
      callbackBaseUrl,
    })).resolves.toEqual({ status: "replaced", generation: 4 });
    expect(provider.refreshDynamicWebhook).not.toHaveBeenCalled();
    expect(persistence.replaceMetadata).toHaveBeenCalledWith(expect.objectContaining({
      expectedGeneration: 3, expectedWebhookId: "71001", newWebhookId: "71002",
    }));
  });

  it("isolates each due connection during bounded reconciliation", async () => {
    const first = configuration;
    const second = { ...configuration, connectionId: "70000000-0000-4000-8000-000000000005", generation: 8 };
    const persistence = store({ listDue: vi.fn(async () => [first, second]) });
    const ensure = vi.fn()
      .mockRejectedValueOnce(new Error("first unavailable"))
      .mockResolvedValueOnce({ status: "refreshed", generation: 8 });
    await expect(reconcileDueJiraWebhooks({
      store: persistence,
      gateway: gateway(),
      getAccessToken: vi.fn(async () => accessToken),
      callbackBaseUrl,
      ensure,
      limit: 20,
    })).resolves.toEqual({ checked: 2, refreshed: 1, replaced: 0, failed: 1 });
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(persistence.listDue).toHaveBeenCalledWith(20);
  });

  it("destroys local state before best-effort provider deletion", async () => {
    const provider = gateway({ deleteDynamicWebhook: vi.fn(async () => { throw new Error("provider down"); }) });
    const persistence = store();
    await expect(disconnectJiraWebhook({
      gateway: provider,
      store: persistence,
      accessToken,
      organisationId,
      userId,
      configuration,
    })).resolves.toBeUndefined();
    expect(persistence.disconnect).toHaveBeenCalledOnce();
    expect(provider.deleteDynamicWebhook).toHaveBeenCalledAfter(vi.mocked(persistence.disconnect));
    expect(persistence.acknowledgeCleanup).not.toHaveBeenCalled();

    const failedLocal = store({ disconnect: vi.fn(async () => { throw new Error("local failure"); }) });
    const secondProvider = gateway();
    await expect(disconnectJiraWebhook({
      gateway: secondProvider,
      store: failedLocal,
      accessToken,
      organisationId,
      userId,
      configuration,
    })).rejects.toThrow("Jira disconnect failed");
    expect(secondProvider.deleteDynamicWebhook).not.toHaveBeenCalled();
  });

  it("drains secret-free cleanup jobs with active credentials and isolates provider failures", async () => {
    const first = {
      cleanupId: "70000000-0000-4000-8000-000000000010",
      organisationId, connectionId, cloudId, webhookId: "71001",
      callbackHash: null,
      callbackOrigin: null,
      lockToken: "70000000-0000-4000-8000-000000000011", attemptCount: 1,
      absentObservations: 0,
    };
    const second = { ...first, cleanupId: "70000000-0000-4000-8000-000000000012", webhookId: "71002" };
    const persistence = store({
      claimCleanup: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
    });
    const provider = gateway({
      deleteDynamicWebhook: vi.fn()
        .mockRejectedValueOnce(new Error("provider down"))
        .mockResolvedValueOnce(undefined),
    });
    await expect(drainJiraWebhookCleanup({
      store: persistence, gateway: provider,
      getAccessToken: vi.fn(async () => accessToken), workerId: "cleanup-worker", batchSize: 2,
    })).resolves.toEqual({ claimed: 2, completed: 1, failed: 1, deferred: 0 });
    expect(persistence.failCleanup).toHaveBeenCalledWith(first.cleanupId, first.lockToken);
    expect(persistence.completeCleanup).toHaveBeenCalledWith(second.cleanupId, second.lockToken);
  });

  it("does not claim another cleanup after the shared worker deadline", async () => {
    const persistence = store({ claimCleanup: vi.fn(async () => null) });
    await expect(drainJiraWebhookCleanup({
      store: persistence,
      gateway: gateway(),
      getAccessToken: vi.fn(async () => accessToken),
      workerId: "cleanup-worker",
      shouldContinue: () => false,
    })).resolves.toEqual({ claimed: 0, completed: 0, failed: 0, deferred: 0 });
    expect(persistence.claimCleanup).not.toHaveBeenCalled();
  });

  it("requires two leased absent observations before terminalizing an idless prepared cleanup", async () => {
    const first = {
      cleanupId: "70000000-0000-4000-8000-000000000020",
      organisationId, connectionId, cloudId, webhookId: null,
      callbackHash: "b".repeat(64),
      callbackOrigin: "https://old-compliance.example",
      lockToken: "70000000-0000-4000-8000-000000000021", attemptCount: 1,
      absentObservations: 0,
    };
    const second = {
      ...first,
      lockToken: "70000000-0000-4000-8000-000000000022",
      attemptCount: 2,
      absentObservations: 1,
    };
    const persistence = store({
      claimCleanup: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
      observeCleanupAbsent: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    });
    const provider = gateway({ listDynamicWebhooks: vi.fn(async () => []) });

    await expect(drainJiraWebhookCleanup({
      store: persistence, gateway: provider,
      getAccessToken: vi.fn(async () => accessToken), workerId: "cleanup-worker", batchSize: 2,
    })).resolves.toEqual({ claimed: 2, completed: 1, failed: 0, deferred: 1 });

    expect(persistence.observeCleanupAbsent).toHaveBeenNthCalledWith(1, first.cleanupId, first.lockToken);
    expect(persistence.observeCleanupAbsent).toHaveBeenNthCalledWith(2, second.cleanupId, second.lockToken);
    expect(provider.deleteDynamicWebhook).not.toHaveBeenCalled();
  });

  it("deletes an idless orphan using its persisted original origin after a domain change", async () => {
    const rawToken = "A".repeat(43);
    const callbackHash = "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a";
    const cleanup = {
      cleanupId: "70000000-0000-4000-8000-000000000030",
      organisationId, connectionId, cloudId, webhookId: null,
      callbackHash,
      callbackOrigin: "https://old-compliance.example",
      lockToken: "70000000-0000-4000-8000-000000000031", attemptCount: 1,
      absentObservations: 0,
    };
    const persistence = store({ claimCleanup: vi.fn().mockResolvedValueOnce(cleanup) });
    const provider = gateway({
      listDynamicWebhooks: vi.fn(async () => [
        {
          id: "71009", jqlFilter: "project = SEC", events: [...JIRA_WEBHOOK_EVENTS],
          expiresAt: "2026-08-01T00:00:00.000Z",
          url: `https://lookalike.example/api/webhooks/jira/${rawToken}`,
        },
        {
          id: "71010", jqlFilter: "project = SEC", events: [...JIRA_WEBHOOK_EVENTS],
          expiresAt: "2026-08-01T00:00:00.000Z",
          url: `https://old-compliance.example/api/webhooks/jira/${rawToken}`,
        },
      ]),
    });

    await expect(drainJiraWebhookCleanup({
      store: persistence, gateway: provider, getAccessToken: vi.fn(async () => accessToken),
      workerId: "cleanup-worker", batchSize: 1,
    })).resolves.toEqual({ claimed: 1, completed: 1, failed: 0, deferred: 0 });

    expect(provider.deleteDynamicWebhook).toHaveBeenCalledWith({
      accessToken, cloudId, webhookId: "71010",
    });
    expect(provider.deleteDynamicWebhook).not.toHaveBeenCalledWith(expect.objectContaining({ webhookId: "71009" }));
  });
});
