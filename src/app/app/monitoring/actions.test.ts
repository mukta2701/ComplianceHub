import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  createServiceClient: vi.fn(),
  runMonitoring: vi.fn(),
  enforceRateLimit: vi.fn(),
  encryptSecret: vi.fn((value: string | null) => value),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve(hoisted.ctx),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: hoisted.createServiceClient,
}));
vi.mock("@/features/monitoring/application/monitor-deps", () => ({
  buildMonitorDependencies: vi.fn(),
}));
vi.mock("@/features/monitoring/application/monitor-run", () => ({
  runMonitoring: hoisted.runMonitoring,
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/security/secrets", () => ({ encryptSecret: hoisted.encryptSecret }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addMonitorSourceAction, runMonitoringNowAction } from "./actions";

describe("runMonitoringNowAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.ctx = {
      membership: { role: "member" },
      organisation: { id: "20000000-0000-4000-8000-000000000001" },
    };
  });

  it("rejects members before constructing a service-role client", async () => {
    await expect(runMonitoringNowAction()).rejects.toThrow("Only workspace operators can run monitoring");

    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
    expect(hoisted.runMonitoring).not.toHaveBeenCalled();
  });

  for (const role of ["owner", "admin"] as const) {
    it(`allows ${role}s to run monitoring`, async () => {
      hoisted.ctx = { membership: { role }, organisation: { id: "20000000-0000-4000-8000-000000000001" } };
      hoisted.createServiceClient.mockReturnValue({ service: true });
      hoisted.runMonitoring.mockResolvedValue(undefined);

      await expect(runMonitoringNowAction()).resolves.toBeUndefined();

      expect(hoisted.createServiceClient).toHaveBeenCalledOnce();
      expect(hoisted.runMonitoring).toHaveBeenCalledOnce();
    });
  }
});

describe("monitoring configuration access", () => {
  beforeEach(() => vi.clearAllMocks());

  function sourceForm() {
    const form = new FormData();
    form.set("owner", "compliancehub");
    form.set("repo", "app");
    form.set("label", "Production repository");
    return form;
  }

  it("rejects members before writing source configuration", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: "user-1" }, organisation: { id: "org-1" },
      membership: { role: "member" },
    };

    await expect(addMonitorSourceAction(sourceForm())).rejects.toThrow("Only workspace operators can manage monitoring configuration");
    expect(from).not.toHaveBeenCalled();
  });

  for (const role of ["owner", "admin"] as const) {
    it(`allows ${role}s to add a monitoring source`, async () => {
      const insert = vi.fn().mockResolvedValue({ error: null });
      hoisted.ctx = {
        supabase: { from: vi.fn(() => ({ insert })) }, user: { id: "user-1" },
        organisation: { id: "org-1" }, membership: { role },
      };

      await expect(addMonitorSourceAction(sourceForm())).resolves.toBeUndefined();
      expect(insert).toHaveBeenCalledOnce();
    });
  }
});
