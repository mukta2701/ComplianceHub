import { describe, expect, it, vi } from "vitest";
import {
  createSupabaseJiraConnectionStore,
  createSupabaseJiraCleanupConnectionStore,
  getFreshJiraAccessToken,
  type JiraPersistenceDatabase,
} from "./jira-token-store";
import { JiraProviderError, type JiraAccessibleResource, type JiraOAuthGateway } from "./jira-oauth";

const organisationId = "95000000-0000-4000-8000-000000000001";
const userId = "95000000-0000-4000-8000-000000000002";
const connectionId = "95000000-0000-4000-8000-000000000003";
const cloudId = "95000000-0000-4000-8000-000000000004";
const leaseId = "95000000-0000-4000-8000-000000000005";
const accessCredential = ["access", "credential", "one"].join("-");
const refreshCredential = ["refresh", "credential", "one"].join("-");
const rotatedAccessCredential = ["access", "credential", "two"].join("-");
const rotatedRefreshCredential = ["refresh", "credential", "two"].join("-");
const siteAName = "Sample Jira A";
const siteBName = "Sample Jira B";
const siteAUrl = ["https://", "sample-a", ".atlassian.net"].join("");
const siteBUrl = ["https://", "sample-b", ".atlassian.net"].join("");

function siteFixture(cloudId: string, name: string, url: string): JiraAccessibleResource {
  const site = Object.create(null) as JiraAccessibleResource;
  site.cloudId = cloudId;
  site.name = name;
  site.url = url;
  site.scopes = ["read:jira-work", "manage:jira-webhook"];
  return site;
}

function database(rpc: JiraPersistenceDatabase["rpc"]): JiraPersistenceDatabase {
  return { rpc };
}

const cipher = {
  seal: (value: string) => `sealed:${value}`,
  open: (value: string) => value.startsWith("sealed:") ? value.slice(7) : null,
};

function provider(overrides: Partial<JiraOAuthGateway> = {}): JiraOAuthGateway {
  return {
    exchangeAuthorizationCode: vi.fn(),
    listAccessibleResources: vi.fn(),
    listProjects: vi.fn(),
    listDynamicWebhooks: vi.fn(),
    registerDynamicWebhook: vi.fn(),
    refreshDynamicWebhook: vi.fn(),
    deleteDynamicWebhook: vi.fn(),
    refreshAuthorization: vi.fn(async () => ({
      accessToken: rotatedAccessCredential,
      refreshToken: rotatedRefreshCredential,
      expiresAt: "2026-07-14T15:00:00.000Z",
      scope: "read:jira-work manage:jira-webhook offline_access",
    })),
    ...overrides,
  };
}

describe("Supabase Jira credential store", () => {
  it("encrypts both credentials and persists a disabled site through one narrow RPC", async () => {
    const rpc = vi.fn(async () => ({ data: connectionId, error: null }));
    const store = createSupabaseJiraConnectionStore(database(rpc), cipher);

    await expect(store.saveAuthorization({
      organisationId,
      userId,
      site: {
        cloudId,
        name: siteAName,
        url: siteAUrl,
        scopes: ["read:jira-work", "manage:jira-webhook"],
      },
      tokens: {
        accessToken: accessCredential,
        refreshToken: refreshCredential,
        expiresAt: "2026-07-14T14:00:00.000Z",
        scope: "read:jira-work manage:jira-webhook offline_access",
      },
    })).resolves.toBe(connectionId);

    expect(rpc).toHaveBeenCalledWith("connect_jira_oauth", {
      target_organisation_id: organisationId,
      target_user_id: userId,
      target_cloud_id: cloudId,
      target_site_name: siteAName,
      encrypted_access_token: `sealed:${accessCredential}`,
      encrypted_refresh_token: `sealed:${refreshCredential}`,
      target_token_expires_at: "2026-07-14T14:00:00.000Z",
    });
  });

  it("keeps a multi-site authorization in a short-lived server-only record", async () => {
    const setupId = "95000000-0000-4000-8000-000000000099";
    const rpc = vi.fn(async () => ({ data: setupId, error: null }));
    const store = createSupabaseJiraConnectionStore(database(rpc), cipher);

    await expect(store.savePendingAuthorization({
      organisationId,
      userId,
      sites: [
        siteFixture(cloudId, siteAName, siteAUrl),
        siteFixture("95000000-0000-4000-8000-000000000006", siteBName, siteBUrl),
      ],
      tokens: {
        accessToken: accessCredential,
        refreshToken: refreshCredential,
        expiresAt: "2026-07-14T14:00:00.000Z",
        scope: "read:jira-work manage:jira-webhook offline_access",
      },
    })).resolves.toBe(setupId);
    expect(rpc).toHaveBeenCalledWith("save_pending_jira_authorization", expect.objectContaining({
      target_organisation_id: organisationId,
      target_user_id: userId,
      encrypted_access_token: `sealed:${accessCredential}`,
      encrypted_refresh_token: `sealed:${refreshCredential}`,
      accessible_sites: expect.any(Array),
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(`\"access_token\":\"${accessCredential}\"`);
  });

  it("reads access credentials without requesting a refresh token", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === "read_jira_access_credential" ? [{
        encrypted_access_token: `sealed:${accessCredential}`,
        token_expires_at: "2026-07-14T14:00:00.000Z",
        refresh_generation: 4,
      }] : null,
      error: null,
    }));
    const store = createSupabaseJiraConnectionStore(database(rpc), cipher);

    await expect(store.readAccessCredential(connectionId)).resolves.toEqual({
      accessToken: accessCredential,
      expiresAt: "2026-07-14T14:00:00.000Z",
      generation: 4,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("refresh_token");
  });

  it("claims, rotates, and atomically completes both encrypted credentials under one lease", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_jira_refresh_lease") return {
        data: [{
          lease_id: leaseId,
          encrypted_access_token: `sealed:${accessCredential}`,
          encrypted_refresh_token: `sealed:${refreshCredential}`,
          token_expires_at: "2026-07-14T13:00:00.000Z",
          refresh_generation: 7,
        }],
        error: null,
      };
      return { data: true, error: null };
    });
    const store = createSupabaseJiraConnectionStore(database(rpc), cipher);

    await expect(store.claimRefreshLease(connectionId)).resolves.toEqual({
      leaseId,
      accessToken: accessCredential,
      refreshToken: refreshCredential,
      expiresAt: "2026-07-14T13:00:00.000Z",
      generation: 7,
    });
    await expect(store.completeRefreshLease({
      connectionId,
      leaseId,
      tokens: {
        accessToken: rotatedAccessCredential,
        refreshToken: rotatedRefreshCredential,
        expiresAt: "2026-07-14T15:00:00.000Z",
        scope: "read:jira-work manage:jira-webhook offline_access",
      },
    })).resolves.toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("complete_jira_refresh_lease", {
      target_connection_id: connectionId,
      claimed_lease_id: leaseId,
      new_encrypted_access_token: `sealed:${rotatedAccessCredential}`,
      new_encrypted_refresh_token: `sealed:${rotatedRefreshCredential}`,
      new_token_expires_at: "2026-07-14T15:00:00.000Z",
    });
  });

  it("accepts the webhook id captured by the sole destructive disconnect RPC", async () => {
    const rpc = vi.fn(async () => ({ data: "71001", error: null }));
    const store = createSupabaseJiraConnectionStore(database(rpc), cipher);

    await expect(store.disconnect({ organisationId, userId, connectionId })).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("disconnect_jira_oauth", {
      target_organisation_id: organisationId,
      target_user_id: userId,
      target_connection_id: connectionId,
    });
  });

  it("binds revoked cleanup credential access to the exact cleanup lease", async () => {
    const cleanupId = "95000000-0000-4000-8000-000000000006";
    const cleanupLockToken = "95000000-0000-4000-8000-000000000007";
    const rpc = vi.fn(async (name: string) => ({
      data: name === "read_jira_cleanup_access_credential" ? [{
        encrypted_access_token: `sealed:${accessCredential}`,
        token_expires_at: "2026-07-14T14:00:00.000Z",
        refresh_generation: 4,
      }] : null,
      error: null,
    }));
    const store = createSupabaseJiraCleanupConnectionStore(
      database(rpc), { cleanupId, cleanupLockToken }, cipher,
    );

    await expect(store.readAccessCredential(connectionId)).resolves.toMatchObject({
      accessToken: accessCredential, generation: 4,
    });
    expect(rpc).toHaveBeenCalledWith("read_jira_cleanup_access_credential", {
      target_connection_id: connectionId,
      target_cleanup_id: cleanupId,
      cleanup_lock_token: cleanupLockToken,
    });
  });
});

describe("getFreshJiraAccessToken", () => {
  it("commits each rotating refresh token and returns the new access credential", async () => {
    const store = {
      saveAuthorization: vi.fn(),
      savePendingAuthorization: vi.fn(),
      finalizePendingAuthorization: vi.fn(),
      readAccessCredential: vi.fn(async () => ({ accessToken: accessCredential, expiresAt: "2026-07-14T13:00:10.000Z", generation: 1 })),
      claimRefreshLease: vi.fn(async () => ({ leaseId, accessToken: accessCredential, refreshToken: refreshCredential, expiresAt: "2026-07-14T13:00:10.000Z", generation: 1 })),
      completeRefreshLease: vi.fn(async () => true),
      releaseRefreshLease: vi.fn(async () => true),
      disconnect: vi.fn(),
    };

    await expect(getFreshJiraAccessToken({
      connectionId,
      gateway: provider(),
      store,
      now: () => new Date("2026-07-14T13:00:00.000Z"),
    })).resolves.toBe(rotatedAccessCredential);
    expect(store.completeRefreshLease).toHaveBeenCalledWith({
      connectionId,
      leaseId,
      tokens: expect.objectContaining({
        accessToken: rotatedAccessCredential,
        refreshToken: rotatedRefreshCredential,
      }),
    });
    expect(store.releaseRefreshLease).not.toHaveBeenCalled();
  });

  it("re-reads the winner's credential when another worker owns the lease", async () => {
    const readAccessCredential = vi.fn()
      .mockResolvedValueOnce({ accessToken: accessCredential, expiresAt: "2026-07-14T13:00:10.000Z", generation: 1 })
      .mockResolvedValueOnce({ accessToken: rotatedAccessCredential, expiresAt: "2026-07-14T15:00:00.000Z", generation: 2 });
    const store = {
      saveAuthorization: vi.fn(),
      savePendingAuthorization: vi.fn(),
      finalizePendingAuthorization: vi.fn(),
      readAccessCredential,
      claimRefreshLease: vi.fn(async () => null),
      completeRefreshLease: vi.fn(),
      releaseRefreshLease: vi.fn(),
      disconnect: vi.fn(),
    };
    const oauth = provider();

    await expect(getFreshJiraAccessToken({
      connectionId,
      gateway: oauth,
      store,
      now: () => new Date("2026-07-14T13:00:00.000Z"),
    })).resolves.toBe(rotatedAccessCredential);
    expect(oauth.refreshAuthorization).not.toHaveBeenCalled();
    expect(readAccessCredential).toHaveBeenCalledTimes(2);
  });

  it("marks authorization_expired and never returns a stale token after invalid_grant", async () => {
    const store = {
      saveAuthorization: vi.fn(),
      savePendingAuthorization: vi.fn(),
      finalizePendingAuthorization: vi.fn(),
      readAccessCredential: vi.fn(async () => ({ accessToken: accessCredential, expiresAt: "2026-07-14T13:00:10.000Z", generation: 1 })),
      claimRefreshLease: vi.fn(async () => ({ leaseId, accessToken: accessCredential, refreshToken: refreshCredential, expiresAt: "2026-07-14T13:00:10.000Z", generation: 1 })),
      completeRefreshLease: vi.fn(),
      releaseRefreshLease: vi.fn(async () => true),
      disconnect: vi.fn(),
    };
    const oauth = provider({
      refreshAuthorization: vi.fn(async () => {
        throw new JiraProviderError("authorization_expired", "Jira access needs to be reconnected.");
      }),
    });

    await expect(getFreshJiraAccessToken({
      connectionId,
      gateway: oauth,
      store,
      now: () => new Date("2026-07-14T13:00:00.000Z"),
    })).rejects.toThrow("Jira access needs to be reconnected.");
    expect(store.releaseRefreshLease).toHaveBeenCalledWith({
      connectionId,
      leaseId,
      failure: "authorization_expired",
    });
    expect(store.completeRefreshLease).not.toHaveBeenCalled();
  });
});
