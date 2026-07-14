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

import { acknowledgeFindingAction, fetchRecentAlertsAction, runMonitoringNowAction } from "./actions";

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

describe("monitoring finding mutations", () => {
  it("scopes acknowledgement to the active organisation and fails closed on no match", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: "user-1" }, organisation: { id: "org-1" },
      membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");

    await expect(acknowledgeFindingAction(form)).rejects.toThrow("Finding was not found in this workspace");
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", "org-1");
  });
});

describe("recent monitoring alerts active workspace scope", () => {
  it("filters the signed-in user's alerts to the active organisation", async () => {
    const result = {
      data: [{
        id: 42,
        message: "Branch protection changed",
        kind: "control_drift",
        created_at: "2026-07-14T08:00:00.000Z",
      }],
    };
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "in", "order"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.limit = vi.fn().mockResolvedValue(result);
    const from = vi.fn(() => builder);
    hoisted.ctx = {
      supabase: { from },
      organisation: { id: "20000000-0000-4000-8000-000000000001" },
      membership: { role: "member" },
    };

    await expect(fetchRecentAlertsAction()).resolves.toEqual([{
      id: 42,
      message: "Branch protection changed",
      kind: "control_drift",
      createdAt: "2026-07-14T08:00:00.000Z",
    }]);

    expect(from).toHaveBeenCalledWith("notifications");
    expect(builder.eq).toHaveBeenCalledWith(
      "organisation_id",
      "20000000-0000-4000-8000-000000000001",
    );
  });
});
