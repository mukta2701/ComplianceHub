import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  createServiceClient: vi.fn(),
  runMonitoring: vi.fn(),
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { runMonitoringNowAction } from "./actions";

describe("runMonitoringNowAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.ctx = {
      membership: { role: "member" },
      organisation: { id: "20000000-0000-4000-8000-000000000001" },
    };
  });

  it("rejects members before constructing a service-role client", async () => {
    await expect(runMonitoringNowAction()).rejects.toThrow("Only workspace operators can manage monitoring");

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
