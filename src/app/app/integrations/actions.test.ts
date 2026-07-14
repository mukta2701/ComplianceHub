import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  encryptSecret: vi.fn((value: string | null) => value),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/security/secrets", () => ({ encryptSecret: hoisted.encryptSecret }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { addConnectionAction } from "./actions";

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
  beforeEach(() => vi.clearAllMocks());

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
      expect(insert).toHaveBeenCalledOnce();
    });
  }
});
