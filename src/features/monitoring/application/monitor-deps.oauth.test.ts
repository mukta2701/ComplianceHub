import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const hoisted = vi.hoisted(() => ({ resolve: vi.fn(), runChecks: vi.fn() }));
vi.mock("./monitor-registry", () => ({ resolveMonitorProvider: hoisted.resolve }));
vi.mock("@/lib/security/secrets", () => ({ decryptSecret: (value: string | null) => value }));

import { buildMonitorDependencies } from "./monitor-deps";

describe("OAuth monitor dependency routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.resolve.mockReturnValue({ runChecks: hoisted.runChecks });
    hoisted.runChecks.mockResolvedValue([]);
  });

  it("uses an enabled same-tenant parent target and broker references for linked OAuth checks", async () => {
    const row = {
      id: "source-1", organisation_id: "org-1", provider: "github",
      config: { owner: "stale", repo: "stale" }, access_token: null,
      connection_mode: "oauth", integration_connection_id: "parent-1",
      broker_connection_id: "stale-connection", broker_provider_config_key: "stale-key",
      integration_connection: {
        id: "parent-1", organisation_id: "org-1", provider: "github", connection_mode: "oauth",
        config: { owner: "acme", repo: "isms" }, enabled: true, revoked_at: null,
        broker_connection_id: "connection-1", broker_provider_config_key: "github-prod",
      },
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "is", "eq"]) builder[method] = vi.fn(() => builder);
    builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [row], error: null }).then(resolve);
    const deps = buildMonitorDependencies({ from: vi.fn(() => builder) } as unknown as SupabaseClient);

    const [source] = await deps.listActiveSources();
    await deps.runChecks(source!);

    expect((builder.select as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "id,organisation_id,provider,config,access_token,connection_mode,integration_connection_id,broker_connection_id,broker_provider_config_key,integration_connection:integration_connections(id,organisation_id,provider,connection_mode,config,enabled,revoked_at,broker_connection_id,broker_provider_config_key)",
    );
    expect(hoisted.resolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github", connectionMode: "oauth",
      config: { owner: "acme", repo: "isms" },
      brokerConnectionId: "connection-1", brokerProviderConfigKey: "github-prod",
    }));
  });

  it("excludes linked OAuth sources whose parent is disabled, revoked, missing, or cross-tenant", async () => {
    const parent = {
      id: "parent-1", organisation_id: "org-1", provider: "github", connection_mode: "oauth",
      config: { owner: "acme", repo: "isms" }, enabled: true, revoked_at: null,
      broker_connection_id: "connection-1", broker_provider_config_key: "github-prod",
    };
    const linked = (id: string, overrides: Record<string, unknown>) => ({
      id, organisation_id: "org-1", provider: "github", config: {}, access_token: null,
      connection_mode: "oauth", integration_connection_id: "parent-1",
      broker_connection_id: "copied-ref", broker_provider_config_key: "copied-key",
      integration_connection: { ...parent, ...overrides },
    });
    const rows = [
      linked("disabled", { enabled: false }),
      linked("revoked", { revoked_at: "2026-07-14T00:00:00Z" }),
      linked("cross-tenant", { organisation_id: "org-2" }),
      { ...linked("missing", {}), integration_connection: null },
      {
        id: "sandbox", organisation_id: "org-1", provider: "github",
        config: { owner: "acme", repo: "sandbox" }, access_token: null,
        connection_mode: "sandbox", integration_connection_id: null,
        broker_connection_id: null, broker_provider_config_key: null, integration_connection: null,
      },
    ];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "is", "eq"]) builder[method] = vi.fn(() => builder);
    builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    const deps = buildMonitorDependencies({ from: vi.fn(() => builder) } as unknown as SupabaseClient);

    await expect(deps.listActiveSources()).resolves.toEqual([
      expect.objectContaining({ id: "sandbox", connectionMode: "sandbox" }),
    ]);
  });
});
