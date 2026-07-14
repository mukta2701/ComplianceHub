import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "30000000-0000-4000-8000-000000000002";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { saveTrustCenterAction } from "./actions";

function settingsForm() {
  const form = new FormData();
  form.set("enabled", "on");
  form.set("slug", "compliancehub");
  form.set("showPolicyTitles", "on");
  form.set("headline", "Security and compliance at a glance");
  return form;
}

describe("Trust Center management access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects members before writing settings", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID },
      membership: { role: "member" },
    };

    await expect(saveTrustCenterAction(settingsForm())).rejects.toThrow("Only workspace operators can manage the Trust Center");
    expect(from).not.toHaveBeenCalled();
  });

  for (const role of ["owner", "admin"] as const) {
    it(`allows ${role}s to save settings`, async () => {
      const upsert = vi.fn().mockResolvedValue({ error: null });
      hoisted.ctx = {
        supabase: { from: vi.fn(() => ({ upsert })) }, user: { id: USER_ID },
        organisation: { id: ORGANISATION_ID }, membership: { role },
      };

      await expect(saveTrustCenterAction(settingsForm())).resolves.toBeUndefined();
      expect(upsert).toHaveBeenCalledOnce();
    });
  }
});
