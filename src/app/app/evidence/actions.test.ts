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

  it("lets an Owner reach the existing create, link, unlink and withdrawal interfaces", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "evidence-1", error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const matched = { select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: "matched-1" }, error: null }) })) };
    const deleteEq = vi.fn(() => matched);
    const updateEq = vi.fn(() => matched);
    const from = vi.fn((table: string) => table === "evidence_links"
      ? { insert, delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: deleteEq })) })) }
      : { update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: updateEq })) })) });
    hoisted.ctx = {
      supabase: { from, rpc, storage: { from: vi.fn() } },
      user: { id: "00000000-0000-4000-8000-000000000002" }, organisation: { id: "00000000-0000-4000-8000-000000000001" }, membership: { role: "owner" },
    };

    await createEvidenceAction(form({ title: "Quarterly access review", kind: "note", description: "Reviewed sample" }));
    await linkEvidenceAction(form({ evidenceId: "evidence-1", target: "control:control-1" }));
    await unlinkEvidenceAction(form({ linkId: "link-1" }));
    await withdrawEvidenceAction(form({ id: "evidence-1" }));

    expect(hoisted.enforceRateLimit).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("create_evidence_record", expect.any(Object));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organisation_id: "00000000-0000-4000-8000-000000000001", evidence_id: "evidence-1", control_id: "control-1" }));
    expect(deleteEq).toHaveBeenCalledWith("organisation_id", "00000000-0000-4000-8000-000000000001");
    expect(updateEq).toHaveBeenCalledWith("organisation_id", "00000000-0000-4000-8000-000000000001");
  });

  it.each([
    ["unlink", unlinkEvidenceAction, { linkId: "missing-link" }, "Could not remove the evidence link"],
    ["withdraw", withdrawEvidenceAction, { id: "missing-evidence" }, "Could not withdraw evidence"],
  ])("rejects a stale %s request when the organisation-scoped mutation matches no record", async (_label, action, values, message) => {
    const unmatched = { select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) };
    const from = vi.fn((table: string) => table === "evidence_links"
      ? { delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => unmatched) })) })) }
      : { update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => unmatched) })) })) });
    hoisted.ctx = {
      supabase: { from }, user: { id: "user-1" }, organisation: { id: "org-1" }, membership: { role: "owner" },
    };

    await expect(action(form(values))).rejects.toThrow(message);
  });
});
