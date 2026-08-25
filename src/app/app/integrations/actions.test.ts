import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const APPROVED_SLACK_WEBHOOK = "https://hooks.slack.com/services/T_TEST/B_TEST/S_TEST";
const APPROVED_SLACK_WEBHOOK_SHA256 = "36b243d5b0e2304cbdf6f5bf362061b4f0e5cdc842c7f407af9253d0207cce52";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  encryptSecret: vi.fn(() => "v1:iv:tag:data"),
  decryptSecret: vi.fn(() => APPROVED_SLACK_WEBHOOK),
  revalidatePath: vi.fn(),
  createNangoConnectSession: vi.fn(),
  deleteNangoConnection: vi.fn(),
  resolveJiraOAuthTarget: vi.fn(),
  verifyNangoConnection: vi.fn(),
  verifyGitHubOAuthTarget: vi.fn(),
  createServiceClient: vi.fn(),
  buildCollectionDependencies: vi.fn(),
  runGitHubCollection: vi.fn(),
  buildMaterialisationDependencies: vi.fn(),
  reconcileApprovedGitHubObservations: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/security/secrets", () => ({
  encryptSecret: hoisted.encryptSecret,
  decryptSecret: hoisted.decryptSecret,
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: hoisted.createServiceClient,
}));
vi.mock("@/features/integrations/application/nango", () => ({
  createNangoConnectSession: hoisted.createNangoConnectSession,
  deleteNangoConnection: hoisted.deleteNangoConnection,
  resolveJiraOAuthTarget: hoisted.resolveJiraOAuthTarget,
  verifyNangoConnection: hoisted.verifyNangoConnection,
  verifyGitHubOAuthTarget: hoisted.verifyGitHubOAuthTarget,
}));
vi.mock("@/features/github/application/collection-deps", () => ({
  buildCollectionDependencies: hoisted.buildCollectionDependencies,
}));
vi.mock("@/features/github/application/run-collection", () => ({
  runGitHubCollection: hoisted.runGitHubCollection,
}));
vi.mock("@/features/github/application/materialise-approved-observations", () => ({
  buildMaterialisationDependencies: hoisted.buildMaterialisationDependencies,
  reconcileApprovedGitHubObservations: hoisted.reconcileApprovedGitHubObservations,
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import {
  addConnectionAction,
  addAlertChannelAction,
  addMonitorSourceAction,
  confirmProviderAuthorizationAction,
  configureOAuthConnectionAction,
  revokeConnectionAction,
  revokeMonitorSourceAction,
  setIntegrationConnectionEnabledAction,
  setAlertChannelEnabledAction,
  setDailyDigestChannelAction,
  setMonitorSourceEnabledAction,
  startProviderAuthorizationAction,
  recheckGitHubInstallationAction,
  setGitHubRepositorySelectedAction,
} from "./actions";

function connectionForm() {
  const form = new FormData();
  form.set("provider", "github");
  form.set("label", "Product repository");
  form.set("owner", "compliancehub");
  form.set("repo", "app");
  form.set("accessToken", "token");
  return form;
}

describe("integration connection access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", APPROVED_SLACK_WEBHOOK_SHA256);
    hoisted.encryptSecret.mockImplementation(() => "v1:iv:tag:data");
    hoisted.decryptSecret.mockReturnValue(APPROVED_SLACK_WEBHOOK);
    hoisted.createNangoConnectSession.mockResolvedValue({ configured: false });
    hoisted.deleteNangoConnection.mockResolvedValue(undefined);
    hoisted.resolveJiraOAuthTarget.mockResolvedValue({ cloudId: "1324a887-45db-4bf4-8e99-ef0ff456d421" });
    hoisted.verifyNangoConnection.mockResolvedValue(undefined);
    hoisted.verifyGitHubOAuthTarget.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects members before writing connection credentials", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID },
      membership: { role: "member" },
    };

    await expect(addConnectionAction(connectionForm())).rejects.toThrow("Only workspace operators can manage integrations");
    expect(from).not.toHaveBeenCalled();
  });

  for (const role of ["owner", "admin"] as const) {
    it(`allows ${role}s to add a connection`, async () => {
      const insert = vi.fn().mockResolvedValue({ error: null });
      hoisted.ctx = {
        supabase: { from: vi.fn(() => ({ insert })) }, user: { id: USER_ID },
        organisation: { id: ORGANISATION_ID }, membership: { role },
      };

      await expect(addConnectionAction(connectionForm())).resolves.toBeUndefined();
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({
        organisation_id: ORGANISATION_ID,
        connection_mode: "sandbox",
        enabled: true,
      }));
    });
  }

  it("rejects members before starting a Nango session", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID, email: "member@example.test" },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "member" },
    };

    await expect(startProviderAuthorizationAction("github")).rejects.toThrow("Only workspace operators can manage integrations");
    expect(hoisted.createNangoConnectSession).not.toHaveBeenCalled();
  });

  it("returns an explicit provider-setup state when Nango is not configured", async () => {
    hoisted.ctx = {
      supabase: { from: vi.fn() }, user: { id: USER_ID, email: "owner@example.test" },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "owner" },
    };

    await expect(startProviderAuthorizationAction("jira")).resolves.toEqual({ configured: false });
    expect(hoisted.createNangoConnectSession).toHaveBeenCalledWith(expect.objectContaining({
      provider: "jira",
      endUser: expect.objectContaining({ id: USER_ID, email: "owner@example.test" }),
      organisation: { id: ORGANISATION_ID, displayName: "Example Ltd" },
    }));
    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(`provider-connect:${USER_ID}`, expect.anything());
  });

  it("does not persist an unverified client-reported broker connection", async () => {
    hoisted.verifyNangoConnection.mockRejectedValue(new Error("Provider authorization does not match this deployment"));
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID, email: "owner@example.test" },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "owner" },
    };

    await expect(confirmProviderAuthorizationAction({
      provider: "github", connectionId: "connection-1", providerConfigKey: "wrong-key",
    })).rejects.toThrow("Provider authorization does not match this deployment");
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
  });

  it("rejects Members before broker verification or service-client construction", async () => {
    hoisted.ctx = {
      supabase: { from: vi.fn() }, user: { id: USER_ID, email: "member@example.test" },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "member" },
    };

    await expect(confirmProviderAuthorizationAction({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
    })).rejects.toThrow("Only workspace operators can manage integrations");
    expect(hoisted.verifyNangoConnection).not.toHaveBeenCalled();
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
  });

  it("persists only a verified broker reference for the active organisation", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const serviceFrom = vi.fn(() => ({ insert }));
    const sessionFrom = vi.fn();
    hoisted.createServiceClient.mockReturnValue({ from: serviceFrom });
    hoisted.ctx = {
      supabase: { from: sessionFrom }, user: { id: USER_ID, email: "admin@example.test" },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "admin" },
    };

    await expect(confirmProviderAuthorizationAction({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
    })).resolves.toBeUndefined();

    expect(hoisted.verifyNangoConnection).toHaveBeenCalledWith({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
      endUserId: USER_ID,
      endUserEmail: "admin@example.test",
      organisationId: ORGANISATION_ID,
    });
    expect(insert).toHaveBeenCalledWith({
      organisation_id: ORGANISATION_ID,
      provider: "github",
      label: "GitHub",
      config: {},
      connection_mode: "oauth",
      broker_connection_id: "connection-1",
      broker_provider_config_key: "github-prod",
      enabled: false,
      access_token: null,
      refresh_token: null,
      connected_by: USER_ID,
    });
    expect(sessionFrom).not.toHaveBeenCalled();
    expect(hoisted.verifyNangoConnection.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.createServiceClient.mock.invocationCallOrder[0]);
    expect(hoisted.createServiceClient.mock.invocationCallOrder[0])
      .toBeLessThan(insert.mock.invocationCallOrder[0]);
  });

  it("fails closed when the service-role OAuth insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: new Error("database detail") });
    hoisted.createServiceClient.mockReturnValue({ from: vi.fn(() => ({ insert })) });
    hoisted.ctx = {
      supabase: { from: vi.fn() }, user: { id: USER_ID, email: "owner@example.test" },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "owner" },
    };

    await expect(confirmProviderAuthorizationAction({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
    })).rejects.toThrow("Could not save the verified provider connection");
    expect(insert).toHaveBeenCalledOnce();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("scopes enable-disable mutations to the active organisation and fails closed on no match", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.eq = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");
    form.set("enabled", "false");

    await expect(setIntegrationConnectionEnabledAction(form)).rejects.toThrow("Connection was not found in this workspace");
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
  });

  it("routes an OAuth enable-disable mutation through an exact service-role update", async () => {
    const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
    lookup.select = vi.fn(() => lookup);
    lookup.eq = vi.fn(() => lookup);
    lookup.is = vi.fn(() => lookup);
    lookup.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "10000000-0000-4000-8000-000000000099", provider: "github", connection_mode: "oauth",
        broker_connection_id: "connection-1", broker_provider_config_key: "github-prod",
      },
      error: null,
    });
    const mutation: Record<string, ReturnType<typeof vi.fn>> = {};
    mutation.update = vi.fn(() => mutation);
    mutation.eq = vi.fn(() => mutation);
    mutation.is = vi.fn(() => mutation);
    mutation.select = vi.fn(() => mutation);
    mutation.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "10000000-0000-4000-8000-000000000099" }, error: null,
    });
    hoisted.createServiceClient.mockReturnValue({ from: vi.fn(() => mutation) });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");
    form.set("enabled", "false");

    await setIntegrationConnectionEnabledAction(form);

    expect(mutation.update).toHaveBeenCalledWith({ enabled: false });
    expect(mutation.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(mutation.eq).toHaveBeenCalledWith("provider", "github");
    expect(mutation.eq).toHaveBeenCalledWith("connection_mode", "oauth");
    expect(mutation.eq).toHaveBeenCalledWith("broker_connection_id", "connection-1");
    expect(mutation.eq).toHaveBeenCalledWith("broker_provider_config_key", "github-prod");
    expect(hoisted.createServiceClient).toHaveBeenCalledOnce();
  });

  it("keeps sandbox enable-disable on the authenticated RLS client", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.select = vi.fn(() => builder);
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.maybeSingle = vi.fn()
      .mockResolvedValueOnce({
        data: {
          id: "10000000-0000-4000-8000-000000000099", provider: "github", connection_mode: "sandbox",
          broker_connection_id: null, broker_provider_config_key: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: "10000000-0000-4000-8000-000000000099" }, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");
    form.set("enabled", "false");

    await setIntegrationConnectionEnabledAction(form);

    expect(builder.update).toHaveBeenCalledWith({ enabled: false });
    expect(builder.eq).toHaveBeenCalledWith("connection_mode", "sandbox");
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
  });

  it("validates and configures an OAuth GitHub target before enabling it", async () => {
    const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
    lookup.eq = vi.fn(() => lookup);
    lookup.select = vi.fn(() => lookup);
    lookup.is = vi.fn(() => lookup);
    lookup.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "10000000-0000-4000-8000-000000000099",
        broker_connection_id: "connection-1",
        broker_provider_config_key: "github-prod",
      },
      error: null,
    });
    const mutation: Record<string, ReturnType<typeof vi.fn>> = {};
    mutation.update = vi.fn(() => mutation);
    mutation.eq = vi.fn(() => mutation);
    mutation.select = vi.fn(() => mutation);
    mutation.is = vi.fn(() => mutation);
    mutation.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "10000000-0000-4000-8000-000000000099" }, error: null,
    });
    hoisted.createServiceClient.mockReturnValue({ from: vi.fn(() => mutation) });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");
    form.set("provider", "github");
    form.set("owner", "compliancehub");
    form.set("repo", "app");

    await expect(configureOAuthConnectionAction(form)).resolves.toBeUndefined();
    expect(hoisted.verifyGitHubOAuthTarget).toHaveBeenCalledWith({
      connectionId: "connection-1", providerConfigKey: "github-prod", owner: "compliancehub", repo: "app",
    });
    expect(mutation.update).toHaveBeenCalledWith({ config: { owner: "compliancehub", repo: "app" }, enabled: true });
    expect(mutation.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(mutation.eq).toHaveBeenCalledWith("connection_mode", "oauth");
    expect(mutation.eq).toHaveBeenCalledWith("provider", "github");
    expect(mutation.eq).toHaveBeenCalledWith("broker_connection_id", "connection-1");
    expect(mutation.eq).toHaveBeenCalledWith("broker_provider_config_key", "github-prod");
    expect(mutation.is).toHaveBeenCalledWith("revoked_at", null);
    expect(hoisted.verifyGitHubOAuthTarget.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.createServiceClient.mock.invocationCallOrder[0]);
  });

  it("stores a verified Jira cloud ID from accessible resources before enabling", async () => {
    const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
    lookup.eq = vi.fn(() => lookup);
    lookup.is = vi.fn(() => lookup);
    lookup.select = vi.fn(() => lookup);
    lookup.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "10000000-0000-4000-8000-000000000099",
        broker_connection_id: "connection-1",
        broker_provider_config_key: "jira-prod",
      },
      error: null,
    });
    const mutation: Record<string, ReturnType<typeof vi.fn>> = {};
    mutation.update = vi.fn(() => mutation);
    mutation.eq = vi.fn(() => mutation);
    mutation.is = vi.fn(() => mutation);
    mutation.select = vi.fn(() => mutation);
    mutation.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "10000000-0000-4000-8000-000000000099" }, error: null,
    });
    hoisted.createServiceClient.mockReturnValue({ from: vi.fn(() => mutation) });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");
    form.set("provider", "jira");
    form.set("baseUrl", "https://acme.atlassian.net");
    form.set("projectKey", "SEC");

    await configureOAuthConnectionAction(form);

    expect(hoisted.resolveJiraOAuthTarget).toHaveBeenCalledWith({
      connectionId: "connection-1", providerConfigKey: "jira-prod",
      baseUrl: "https://acme.atlassian.net", projectKey: "SEC",
    });
    expect(mutation.update).toHaveBeenCalledWith({
      config: {
        baseUrl: "https://acme.atlassian.net", projectKey: "SEC",
        cloudId: "1324a887-45db-4bf4-8e99-ef0ff456d421",
      },
      enabled: true,
    });
    expect(hoisted.resolveJiraOAuthTarget.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.createServiceClient.mock.invocationCallOrder[0]);
  });

  it("retires the remote broker connection before locally revoking it", async () => {
    const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
    lookup.eq = vi.fn(() => lookup);
    lookup.is = vi.fn(() => lookup);
    lookup.select = vi.fn(() => lookup);
    lookup.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "10000000-0000-4000-8000-000000000099", provider: "github", connection_mode: "oauth",
        broker_connection_id: "connection-1", broker_provider_config_key: "github-prod",
      },
      error: null,
    });
    const mutation: Record<string, ReturnType<typeof vi.fn>> = {};
    mutation.update = vi.fn(() => mutation);
    mutation.eq = vi.fn(() => mutation);
    mutation.is = vi.fn(() => mutation);
    mutation.select = vi.fn(() => mutation);
    mutation.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "10000000-0000-4000-8000-000000000099" }, error: null,
    });
    hoisted.createServiceClient.mockReturnValue({ from: vi.fn(() => mutation) });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");

    await revokeConnectionAction(form);

    expect(hoisted.deleteNangoConnection).toHaveBeenCalledWith({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
    });
    expect(hoisted.deleteNangoConnection.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.createServiceClient.mock.invocationCallOrder[0]);
    expect(hoisted.createServiceClient.mock.invocationCallOrder[0])
      .toBeLessThan(mutation.update.mock.invocationCallOrder[0]);
    expect(mutation.eq).toHaveBeenCalledWith("broker_connection_id", "connection-1");
    expect(mutation.eq).toHaveBeenCalledWith("broker_provider_config_key", "github-prod");
    expect(mutation.is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("does not locally revoke when retiring the remote broker fails", async () => {
    hoisted.deleteNangoConnection.mockRejectedValue(new Error("Provider connection could not be retired"));
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "10000000-0000-4000-8000-000000000099", provider: "github", connection_mode: "oauth",
        broker_connection_id: "connection-1", broker_provider_config_key: "github-prod",
      },
      error: null,
    });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");

    await expect(revokeConnectionAction(form)).rejects.toThrow("Provider connection could not be retired");
    expect(builder.update).not.toHaveBeenCalled();
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
  });

  it("keeps sandbox soft-revoke on the authenticated RLS client", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn()
      .mockResolvedValueOnce({
        data: {
          id: "10000000-0000-4000-8000-000000000099", provider: "github", connection_mode: "sandbox",
          broker_connection_id: null, broker_provider_config_key: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: "10000000-0000-4000-8000-000000000099" }, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");

    await revokeConnectionAction(form);

    expect(hoisted.deleteNangoConnection).not.toHaveBeenCalled();
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ revoked_at: expect.any(String), enabled: false });
    expect(builder.eq).toHaveBeenCalledWith("connection_mode", "sandbox");
  });

  it("rejects an unsafe Jira target before updating the database", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");
    form.set("provider", "jira");
    form.set("baseUrl", "http://169.254.169.254");
    form.set("projectKey", "SEC");

    await expect(configureOAuthConnectionAction(form)).rejects.toThrow("Jira base URL must be an Atlassian Cloud HTTPS URL");
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
  });

  it("rejects Members before writing monitoring or alert configuration", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID },
      membership: { role: "member" },
    };
    const source = new FormData();
    source.set("owner", "acme"); source.set("repo", "isms");
    const channel = new FormData();
    channel.set("endpoint", "https://hooks.slack.com/services/T/B/X"); channel.set("minSeverity", "high");

    await expect(addMonitorSourceAction(source)).rejects.toThrow("Only workspace operators can manage integrations");
    await expect(addAlertChannelAction(channel)).rejects.toThrow("Only a workspace Owner can manage Slack destinations");
    expect(from).not.toHaveBeenCalled();
  });

  it("allows an Admin to add monitoring configuration but rejects Slack configuration before mutation", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => ({ insert })) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const source = new FormData();
    source.set("owner", "acme"); source.set("repo", "isms"); source.set("label", "Production GitHub");
    const channel = new FormData();
    channel.set("endpoint", APPROVED_SLACK_WEBHOOK); channel.set("minSeverity", "high");

    await addMonitorSourceAction(source);
    await expect(addAlertChannelAction(channel)).rejects.toThrow("Only a workspace Owner");

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organisation_id: ORGANISATION_ID, enabled: true }));
    expect(hoisted.encryptSecret).not.toHaveBeenCalledWith(APPROVED_SLACK_WEBHOOK);
  });

  it("fails an unapproved Slack destination before rate limiting, encryption, persistence, or revalidation", async () => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", "b".repeat(64));
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const channel = new FormData();
    channel.set("endpoint", APPROVED_SLACK_WEBHOOK); channel.set("minSeverity", "high");

    await expect(addAlertChannelAction(channel)).rejects.toThrow("Slack destination is not approved");

    expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
    expect(hoisted.encryptSecret).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("stores only the canonical approved URL envelope and its computed digest", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => ({ insert })) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const channel = new FormData();
    channel.set("endpoint", "HTTPS://HOOKS.SLACK.COM/services/T_TEST/B_TEST/S_TEST");
    channel.set("minSeverity", "high");

    await addAlertChannelAction(channel);

    expect(hoisted.encryptSecret).toHaveBeenCalledWith(APPROVED_SLACK_WEBHOOK);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        webhookUrl: "v1:iv:tag:data",
        webhookSha256: APPROVED_SLACK_WEBHOOK_SHA256,
      },
    }));
  });

  it("accepts Slack Gov incoming-webhook URLs", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => ({ insert })) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const channel = new FormData();
    const govUrl = "https://hooks.slack-gov.com/services/T_TEST/B_TEST/S_TEST";
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", "5430f2455f30bd64452ca6f7f517ca3e3d74d05151a68355dcb8252fc121cb60");
    channel.set("endpoint", govUrl); channel.set("minSeverity", "high");

    await addAlertChannelAction(channel);

    expect(hoisted.encryptSecret).toHaveBeenCalledWith(govUrl);
  });

  it("rejects malformed official-looking Slack webhook URLs before writing", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const channel = new FormData();
    channel.set("endpoint", "https://hooks.slack.com/services/T/B/X?redirect=https://example.test"); channel.set("minSeverity", "high");

    await expect(addAlertChannelAction(channel)).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.encryptSecret).not.toHaveBeenCalled();
  });

  it.each([
    ["monitor source", setMonitorSourceEnabledAction, "monitor_sources"],
    ["alert channel", setAlertChannelEnabledAction, "alert_channels"],
  ] as const)("scopes %s enable-disable mutations to the active organisation", async (_label, action, table) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "10000000-0000-4000-8000-000000000099" }, error: null });
    const from = vi.fn(() => builder);
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099"); form.set("enabled", "false");

    await action(form);

    expect(from).toHaveBeenCalledWith(table);
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
  });

  it("rejects enabling a legacy or mismatched Slack destination before update", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "update"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({
      data: { config: { webhookUrl: APPROVED_SLACK_WEBHOOK } },
      error: null,
    });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099"); form.set("enabled", "true");

    await expect(setAlertChannelEnabledAction(form)).rejects.toThrow("Slack destination is not approved");

    expect(hoisted.decryptSecret).not.toHaveBeenCalled();
    expect(builder.update).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the Slack disable stop path available when no allow digest is configured", async () => {
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", undefined);
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["update", "eq", "select"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "10000000-0000-4000-8000-000000000099" }, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099"); form.set("enabled", "false");

    await expect(setAlertChannelEnabledAction(form)).resolves.toBeUndefined();
    expect(builder.update).toHaveBeenCalledWith({ enabled: false });
    expect(hoisted.decryptSecret).not.toHaveBeenCalled();
  });

  it("lets only an Owner atomically select the daily digest channel", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({
      data: { config: { webhookUrl: "v1:iv:tag:data", webhookSha256: APPROVED_SLACK_WEBHOOK_SHA256 } },
      error: null,
    });
    const form = new FormData();
    form.set("channelId", "10000000-0000-4000-8000-000000000099");
    hoisted.ctx = {
      supabase: { rpc, from: vi.fn(() => builder) }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };

    await setDailyDigestChannelAction(form);

    expect(rpc).toHaveBeenCalledWith("set_daily_digest_channel", {
      target_organisation_id: ORGANISATION_ID,
      target_channel_id: "10000000-0000-4000-8000-000000000099",
    });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/integrations");

    hoisted.ctx = {
      supabase: { rpc, from: vi.fn(() => builder) }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    await expect(setDailyDigestChannelAction(form)).rejects.toThrow("Only a workspace Owner");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects selecting a legacy Slack destination before RPC or decryption", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({
      data: { config: { webhookUrl: APPROVED_SLACK_WEBHOOK } }, error: null,
    });
    const rpc = vi.fn();
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder), rpc }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("channelId", "10000000-0000-4000-8000-000000000099");

    await expect(setDailyDigestChannelAction(form)).rejects.toThrow("Slack destination is not approved");
    expect(hoisted.decryptSecret).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an empty digest destination to null and rejects unsuccessful RPC outcomes", async () => {
    const form = new FormData();
    form.set("channelId", "");
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    hoisted.ctx = {
      supabase: { rpc }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };

    await setDailyDigestChannelAction(form);
    expect(rpc).toHaveBeenCalledWith("set_daily_digest_channel", {
      target_organisation_id: ORGANISATION_ID,
      target_channel_id: null,
    });

    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(setDailyDigestChannelAction(form)).rejects.toThrow("Could not update the daily digest channel");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "private database detail" } });
    await expect(setDailyDigestChannelAction(form)).rejects.toThrow("Could not update the daily digest channel");
  });

  it.each([
    ["enable or disable", setMonitorSourceEnabledAction, true],
    ["revoke", revokeMonitorSourceAction, false],
  ] as const)("rejects a forged attempt to %s a linked OAuth monitor source", async (_label, action, needsEnabled) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["update", "eq", "is", "select"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");
    if (needsEnabled) form.set("enabled", "false");

    await expect(action(form)).rejects.toThrow();

    expect(builder.is).toHaveBeenCalledWith("integration_connection_id", null);
  });
});

describe("GitHub shadow collection actions", () => {
  const INSTALLATION_ID = "20000000-0000-4000-8000-000000000010";
  const REPOSITORY_ID = "20000000-0000-4000-8000-000000000011";
  const terminalRuns = [{
    collectionRunId: "20000000-0000-4000-8000-000000000012",
    organisationId: ORGANISATION_ID,
    installationId: INSTALLATION_ID,
    repositoryId: REPOSITORY_ID,
    providerRepositoryId: 71,
    status: "succeeded" as const,
  }];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_APP_PRIVATE_KEY = "private-key";
    process.env.GITHUB_APPROVED_SECURITY_WORKFLOW_IDS = "101,202";
    hoisted.buildCollectionDependencies.mockReturnValue({ dependency: "collection" });
    hoisted.buildMaterialisationDependencies.mockReturnValue({ dependency: "materialisation" });
    hoisted.reconcileApprovedGitHubObservations.mockResolvedValue({
      runsConsidered: 1,
      materialised: 1,
      unchanged: 0,
      awaitingApproval: 0,
      needsAttention: 0,
    });
    hoisted.runGitHubCollection.mockResolvedValue({
      installationsChecked: 1,
      repositoriesChecked: 1,
      observationsStored: 15,
      repositoriesFailed: 0,
      repositoriesDeferred: 1,
      runsPartial: 0,
      terminalRuns,
    });
  });

  it("rejects Members before repository selection reaches Supabase", async () => {
    const rpc = vi.fn();
    hoisted.ctx = {
      supabase: { rpc }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "member" },
    };
    const form = new FormData();
    form.set("repositoryId", REPOSITORY_ID);
    form.set("selected", "true");

    await expect(setGitHubRepositorySelectedAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not update repository scope. Please try again.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects Admins before repository selection reaches Supabase", async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    hoisted.ctx = {
      supabase: { from, rpc }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("repositoryId", REPOSITORY_ID);
    form.set("selected", "true");

    await expect(setGitHubRepositorySelectedAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not update repository scope. Please try again.",
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["not-a-uuid", "true"],
    [REPOSITORY_ID, "yes"],
    [REPOSITORY_ID, "1"],
  ])("rejects invalid repository selection input before the checked RPC", async (repositoryId, selected) => {
    const rpc = vi.fn();
    hoisted.ctx = {
      supabase: { rpc }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("repositoryId", repositoryId);
    form.set("selected", selected);

    await expect(setGitHubRepositorySelectedAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not update repository scope. Please try again.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a repository from a sibling workspace before calling the selection RPC", async () => {
    const rpc = vi.fn();
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const organisationFilter = vi.fn().mockReturnValue({ maybeSingle });
    const repositoryFilter = vi.fn().mockReturnValue({ eq: organisationFilter });
    const select = vi.fn().mockReturnValue({ eq: repositoryFilter });
    const from = vi.fn().mockReturnValue({ select });
    hoisted.ctx = {
      supabase: { from, rpc }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("repositoryId", REPOSITORY_ID);
    form.set("selected", "true");

    await expect(setGitHubRepositorySelectedAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not update repository scope. Please try again.",
    });
    expect(from).toHaveBeenCalledWith("github_repositories");
    expect(select).toHaveBeenCalledWith("id");
    expect(repositoryFilter).toHaveBeenCalledWith("id", REPOSITORY_ID);
    expect(organisationFilter).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the authenticated Owner RPC with exact derived arguments and requires true", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: REPOSITORY_ID }, error: null });
    const organisationFilter = vi.fn().mockReturnValue({ maybeSingle });
    const repositoryFilter = vi.fn().mockReturnValue({ eq: organisationFilter });
    const select = vi.fn().mockReturnValue({ eq: repositoryFilter });
    const from = vi.fn().mockReturnValue({ select });
    hoisted.ctx = {
      supabase: { from, rpc }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("repositoryId", REPOSITORY_ID);
    form.set("selected", "false");

    await expect(setGitHubRepositorySelectedAction(form)).resolves.toEqual({
      ok: true,
      message: "Repository scope updated.",
    });
    expect(rpc).toHaveBeenCalledWith("set_github_repository_selected", {
      target_repository_id: REPOSITORY_ID,
      target_selected: false,
    });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/integrations");

    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(setGitHubRepositorySelectedAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not update repository scope. Please try again.",
    });
  });

  it("rejects Members before installation lookup or service collection", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "member" },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    await expect(recheckGitHubInstallationAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not recheck this GitHub installation. Please try again.",
    });
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
    expect(hoisted.runGitHubCollection).not.toHaveBeenCalled();
  });

  it("rejects client-supplied organisation and request keys rather than trusting them", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);
    form.set("organisationId", "20000000-0000-4000-8000-000000000099");
    form.set("requestKey", "manual:client-controlled");

    await expect(recheckGitHubInstallationAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not recheck this GitHub installation. Please try again.",
    });
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.runGitHubCollection).not.toHaveBeenCalled();
  });

  it("looks up one active permission-verified installation through operator RLS before collection", async () => {
    const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
    lookup.select = vi.fn(() => lookup);
    lookup.eq = vi.fn(() => lookup);
    lookup.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: INSTALLATION_ID, status: "active", permissions_ok: true }, error: null,
    });
    const sessionFrom = vi.fn(() => lookup);
    const service = { from: vi.fn(), rpc: vi.fn() };
    hoisted.createServiceClient.mockReturnValue(service);
    hoisted.ctx = {
      supabase: { from: sessionFrom }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    const result = await recheckGitHubInstallationAction(form);

    expect(lookup.select).toHaveBeenCalledWith("id,status,permissions_ok");
    expect(lookup.eq).toHaveBeenNthCalledWith(1, "id", INSTALLATION_ID);
    expect(lookup.eq).toHaveBeenNthCalledWith(2, "organisation_id", ORGANISATION_ID);
    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(
      `github-manual:${ORGANISATION_ID}:${USER_ID}`,
      { limit: 5, windowMs: 60_000 },
    );
    expect(hoisted.buildCollectionDependencies).toHaveBeenCalledWith(service, {
      appId: "123456",
      privateKey: "private-key",
      approvedSecurityWorkflowIds: [101, 202],
    });
    expect(hoisted.runGitHubCollection).toHaveBeenCalledWith(
      { dependency: "collection" },
      {
        trigger: "manual",
        installationId: INSTALLATION_ID,
        requestKey: expect.stringMatching(/^manual:[0-9a-f-]{36}$/),
      },
    );
    expect(hoisted.buildMaterialisationDependencies).toHaveBeenCalledWith(service);
    expect(hoisted.reconcileApprovedGitHubObservations).toHaveBeenCalledWith(
      { dependency: "materialisation" },
      {
        limit: 100,
        terminalRuns,
      },
    );
    expect(hoisted.runGitHubCollection.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.reconcileApprovedGitHubObservations.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      ok: true,
      message: "Recheck complete: 1 checked, 1 deferred, 0 failed.",
      summary: {
        installationsChecked: 1,
        repositoriesChecked: 1,
        observationsStored: 15,
        repositoriesFailed: 0,
        repositoriesDeferred: 1,
        runsPartial: 0,
        terminalRuns,
      },
      materialisation: {
        runsConsidered: 1,
        materialised: 1,
        unchanged: 0,
        awaitingApproval: 0,
        needsAttention: 0,
      },
    });
  });

  it("surfaces post-terminal materialisation attention without changing the collection summary", async () => {
    const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
    lookup.select = vi.fn(() => lookup);
    lookup.eq = vi.fn(() => lookup);
    lookup.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: INSTALLATION_ID, status: "active", permissions_ok: true }, error: null,
    });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    hoisted.createServiceClient.mockReturnValue({});
    hoisted.reconcileApprovedGitHubObservations.mockResolvedValue({
      runsConsidered: 1,
      materialised: 0,
      unchanged: 0,
      awaitingApproval: 0,
      needsAttention: 1,
    });
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    const result = await recheckGitHubInstallationAction(form);

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      message: "Recheck complete, but official GitHub records need attention: 1 checked, 1 deferred, 0 failed.",
      summary: expect.objectContaining({ repositoriesChecked: 1, repositoriesDeferred: 1, repositoriesFailed: 0 }),
      materialisation: expect.objectContaining({ needsAttention: 1 }),
    }));
  });

  it.each([
    { data: { id: INSTALLATION_ID, status: "suspended", permissions_ok: true }, label: "suspended" },
    { data: { id: INSTALLATION_ID, status: "active", permissions_ok: false }, label: "missing permissions" },
    { data: null, label: "not found" },
  ])("fails closed for an installation that is $label", async ({ data }) => {
    const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
    lookup.select = vi.fn(() => lookup);
    lookup.eq = vi.fn(() => lookup);
    lookup.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    await expect(recheckGitHubInstallationAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not recheck this GitHub installation. Please try again.",
    });
    expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
    expect(hoisted.runGitHubCollection).not.toHaveBeenCalled();
  });

  it("redacts provider and persistence failures from manual action results", async () => {
    const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
    lookup.select = vi.fn(() => lookup);
    lookup.eq = vi.fn(() => lookup);
    lookup.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: INSTALLATION_ID, status: "active", permissions_ok: true }, error: null,
    });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    hoisted.createServiceClient.mockReturnValue({});
    hoisted.runGitHubCollection.mockRejectedValue(new Error("provider-token-sensitive-detail"));
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    const result = await recheckGitHubInstallationAction(form);

    expect(result).toEqual({
      ok: false,
      message: "Could not recheck this GitHub installation. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("provider-token-sensitive-detail");
  });
});
