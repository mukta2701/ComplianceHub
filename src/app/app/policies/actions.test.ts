import { beforeEach, describe, expect, it, vi } from "vitest";

const POLICY_ID = "78000000-0000-4000-8000-000000000001";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve(hoisted.ctx),
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { acceptPolicyAction } from "./actions";

describe("acceptPolicyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates acceptance authority to the narrow database RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: POLICY_ID, error: null });
    const from = vi.fn(() => {
      throw new Error("acceptance action must not read or write acceptance tables directly");
    });
    hoisted.ctx = {
      supabase: { rpc, from },
      user: { id: "78000000-0000-4000-8000-000000000002" },
      organisation: { id: "78000000-0000-4000-8000-000000000003" },
    };
    const form = new FormData();
    form.set("id", POLICY_ID);
    form.set("acceptedVersion", "999");
    form.set("acceptedAt", "2000-01-01T00:00:00Z");

    await expect(acceptPolicyAction(form)).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("accept_policy", { target_policy_id: POLICY_ID });
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).toHaveBeenCalledWith(`/app/policies/${POLICY_ID}`);
  });

  it("returns a generic error when the database refuses acceptance", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "sensitive database detail" } });
    hoisted.ctx = {
      supabase: { rpc, from: vi.fn() },
      user: { id: "78000000-0000-4000-8000-000000000002" },
      organisation: { id: "78000000-0000-4000-8000-000000000003" },
    };
    const form = new FormData();
    form.set("id", POLICY_ID);

    await expect(acceptPolicyAction(form)).rejects.toThrow("Could not record your acceptance");
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });
});
