import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  upsert: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve(hoisted.ctx),
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { updateRiskMatrixConfigAction } from "./config-actions";

function form(overrides: Record<string, string> = {}): FormData {
  const value = new FormData();
  value.set("lowMax", overrides.lowMax ?? "4");
  value.set("moderateMax", overrides.moderateMax ?? "9");
  value.set("highMax", overrides.highMax ?? "14");
  value.set("appetite", overrides.appetite ?? "10");
  return value;
}

describe("risk matrix configuration workspace access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.upsert.mockResolvedValue({ error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => ({ upsert: hoisted.upsert })) },
      user: { id: "user-1" },
      organisation: { id: "org-1" },
      membership: { role: "member" },
    };
  });

  it("rejects members before parsing or mutating the configuration", async () => {
    await expect(updateRiskMatrixConfigAction(form())).rejects.toThrow(
      "Only workspace operators can manage risk matrix configuration",
    );
    expect(hoisted.upsert).not.toHaveBeenCalled();
  });

  for (const role of ["owner", "admin"] as const) {
    it(`allows ${role}s to update the active workspace configuration`, async () => {
      hoisted.ctx = {
        ...hoisted.ctx as Record<string, unknown>,
        membership: { role },
      };

      await expect(updateRiskMatrixConfigAction(form())).resolves.toBeUndefined();
      expect(hoisted.upsert).toHaveBeenCalledWith(expect.objectContaining({
        organisation_id: "org-1",
        low_max: 4,
        moderate_max: 9,
        high_max: 14,
        appetite_threshold: 10,
        updated_by: "user-1",
      }), { onConflict: "organisation_id" });
      expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/risks");
    });
  }
});
