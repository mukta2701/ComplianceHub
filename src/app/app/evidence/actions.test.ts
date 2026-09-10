import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: vi.fn() }));

import {
  createEvidenceAction,
  linkEvidenceAction,
  unlinkEvidenceAction,
  withdrawEvidenceAction,
} from "./actions";

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("evidence management access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.enforceRateLimit.mockResolvedValue(undefined);
  });

  it("rejects Members from every Evidence mutation before database, upload, RPC, or rate-limit work", async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    const upload = vi.fn();
    hoisted.ctx = {
      supabase: { from, rpc, storage: { from: vi.fn(() => ({ upload })) } },
      user: { id: "user-1" }, organisation: { id: "org-1" }, membership: { role: "member" },
    };

    await expect(createEvidenceAction(form())).rejects.toThrow("Only workspace operators can manage evidence");
    await expect(linkEvidenceAction(form())).rejects.toThrow("Only workspace operators can manage evidence");
    await expect(unlinkEvidenceAction(form())).rejects.toThrow("Only workspace operators can manage evidence");
    await expect(withdrawEvidenceAction(form())).rejects.toThrow("Only workspace operators can manage evidence");

    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
  });
});
