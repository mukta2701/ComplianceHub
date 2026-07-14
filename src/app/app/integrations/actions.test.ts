import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  encryptSecret: vi.fn((value: string | null) => value),
  revalidatePath: vi.fn(),
  createNangoConnectSession: vi.fn(),
  verifyNangoConnection: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/security/secrets", () => ({ encryptSecret: hoisted.encryptSecret }));
vi.mock("@/features/integrations/application/nango", () => ({
  createNangoConnectSession: hoisted.createNangoConnectSession,
  verifyNangoConnection: hoisted.verifyNangoConnection,
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import {
  addConnectionAction,
  addAlertChannelAction,
  addMonitorSourceAction,
  confirmProviderAuthorizationAction,
  configureOAuthConnectionAction,
  setIntegrationConnectionEnabledAction,
  setAlertChannelEnabledAction,
  setMonitorSourceEnabledAction,
  startProviderAuthorizationAction,
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
    hoisted.createNangoConnectSession.mockResolvedValue({ configured: false });
    hoisted.verifyNangoConnection.mockResolvedValue(undefined);
  });

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
  });

  it("persists only a verified broker reference for the active organisation", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID, email: "admin@example.test" },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "admin" },
    };

    await expect(confirmProviderAuthorizationAction({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
    })).resolves.toBeUndefined();

    expect(hoisted.verifyNangoConnection).toHaveBeenCalledWith({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
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
  });

  it("scopes enable-disable mutations to the active organisation and fails closed on no match", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
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
    expect(builder.update).toHaveBeenCalledWith({ enabled: false });
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
  });

  it("validates and configures an OAuth GitHub target before enabling it", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "10000000-0000-4000-8000-000000000099" }, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID, name: "Example Ltd" }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");
    form.set("provider", "github");
    form.set("owner", "compliancehub");
    form.set("repo", "app");

    await expect(configureOAuthConnectionAction(form)).resolves.toBeUndefined();
    expect(builder.update).toHaveBeenCalledWith({ config: { owner: "compliancehub", repo: "app" }, enabled: true });
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(builder.eq).toHaveBeenCalledWith("connection_mode", "oauth");
    expect(builder.eq).toHaveBeenCalledWith("provider", "github");
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
    await expect(addAlertChannelAction(channel)).rejects.toThrow("Only workspace operators can manage integrations");
    expect(from).not.toHaveBeenCalled();
  });

  it("allows an Admin to add monitoring and Slack configuration without exposing secrets", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => ({ insert })) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const source = new FormData();
    source.set("owner", "acme"); source.set("repo", "isms"); source.set("label", "Production GitHub");
    const channel = new FormData();
    channel.set("endpoint", "https://hooks.slack.com/services/T/B/X"); channel.set("minSeverity", "high");

    await addMonitorSourceAction(source);
    await addAlertChannelAction(channel);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organisation_id: ORGANISATION_ID, enabled: true }));
    expect(hoisted.encryptSecret).toHaveBeenCalledWith("https://hooks.slack.com/services/T/B/X");
  });

  it.each([
    ["monitor source", setMonitorSourceEnabledAction, "monitor_sources"],
    ["alert channel", setAlertChannelEnabledAction, "alert_channels"],
  ] as const)("scopes %s enable-disable mutations to the active organisation", async (_label, action, table) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
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
});
