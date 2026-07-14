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

  it("loads broker references and resolves checks by source mode", async () => {
    const row = {
      id: "source-1", organisation_id: "org-1", provider: "github",
      config: { owner: "acme", repo: "isms" }, access_token: null,
      connection_mode: "oauth", broker_connection_id: "connection-1",
      broker_provider_config_key: "github-prod",
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "is", "eq"]) builder[method] = vi.fn(() => builder);
    builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [row], error: null }).then(resolve);
    const deps = buildMonitorDependencies({ from: vi.fn(() => builder) } as unknown as SupabaseClient);

    const [source] = await deps.listActiveSources();
    await deps.runChecks(source!);

    expect((builder.select as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "id,organisation_id,provider,config,access_token,connection_mode,broker_connection_id,broker_provider_config_key",
    );
    expect(hoisted.resolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github", connectionMode: "oauth",
      brokerConnectionId: "connection-1", brokerProviderConfigKey: "github-prod",
    }));
  });
});
