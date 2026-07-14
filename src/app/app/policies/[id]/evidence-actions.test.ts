import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { linkPolicyEvidenceAction } from "./evidence-actions";

function evidenceForm() {
  const form = new FormData();
  form.set("policyId", "policy-1");
  form.set("evidenceId", "evidence-1");
  return form;
}

describe("policy evidence management access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects members before writing an evidence link", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: "user-1" }, organisation: { id: "org-1" },
      membership: { role: "member" },
    };

    await expect(linkPolicyEvidenceAction(evidenceForm())).rejects.toThrow("Only workspace operators can manage policy evidence");
    expect(from).not.toHaveBeenCalled();
  });

  for (const role of ["owner", "admin"] as const) {
    it(`allows ${role}s to link policy evidence`, async () => {
      const insert = vi.fn().mockResolvedValue({ error: null });
      hoisted.ctx = {
        supabase: { from: vi.fn(() => ({ insert })) }, user: { id: "user-1" },
        organisation: { id: "org-1" }, membership: { role },
      };

      await expect(linkPolicyEvidenceAction(evidenceForm())).resolves.toBeUndefined();
      expect(insert).toHaveBeenCalledOnce();
    });
  }
});
