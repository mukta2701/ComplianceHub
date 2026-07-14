import { beforeEach, describe, expect, it, vi } from "vitest";

const POLICY_ID = "78000000-0000-4000-8000-000000000001";
const USER_ID = "78000000-0000-4000-8000-000000000002";
const ORGANISATION_ID = "78000000-0000-4000-8000-000000000003";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: hoisted.redirect }));

import { approvePolicyAction, createPolicyAction, updatePolicyAction } from "./actions";

function policyForm(body = "Current policy text") {
  const form = new FormData();
  form.set("id", POLICY_ID);
  form.set("reference", "POL-001");
  form.set("title", "Security policy");
  form.set("body", body);
  form.set("ownerId", "");
  form.set("reviewDue", "");
  return form;
}

describe("policy management access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects members before creating a policy", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID },
      membership: { role: "member" },
    };

    await expect(createPolicyAction(policyForm())).rejects.toThrow("Only workspace operators can manage policies");
    expect(from).not.toHaveBeenCalled();
  });

  it("allows admins to approve policies", async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    hoisted.ctx = {
      supabase: { from: vi.fn(() => ({ update })) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("id", POLICY_ID);

    await expect(approvePolicyAction(form)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledOnce();
  });
});

describe("policy update concurrency", () => {
  beforeEach(() => vi.clearAllMocks());

  function updateContext(returnedPolicy: { version: number } | null) {
    const read = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { body: "Old text", version: 4, owner_id: null }, error: null }) })),
      })),
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: returnedPolicy, error: null });
    const selectUpdated = vi.fn(() => ({ maybeSingle }));
    const versionEq = vi.fn(() => ({ select: selectUpdated }));
    const idEq = vi.fn(() => ({ eq: versionEq }));
    const update = vi.fn(() => ({ eq: idEq }));
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValueOnce(read).mockReturnValueOnce({ update });
    hoisted.ctx = {
      supabase: { from, rpc }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID },
      membership: { role: "owner" },
    };
    return { update, versionEq, rpc };
  }

  it("uses the expected version and trusts the version returned by the database", async () => {
    const { update, versionEq, rpc } = updateContext({ version: 5 });
    const form = policyForm("New material text");
    form.set("expectedVersion", "4");

    await expect(updatePolicyAction(form)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith(expect.not.objectContaining({ version: expect.anything() }));
    expect(versionEq).toHaveBeenCalledWith("version", 4);
    expect(rpc).toHaveBeenCalledWith("notify_policy_reaccept", {
      target_policy_id: POLICY_ID,
      note: "Now at version 5.",
    });
  });

  it("reports a stale edit when the expected version no longer matches", async () => {
    updateContext(null);
    const form = policyForm("New material text");
    form.set("expectedVersion", "4");

    await expect(updatePolicyAction(form)).rejects.toThrow("This policy changed while you were editing it");
  });
});
