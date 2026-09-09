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
vi.mock("next/navigation", () => ({ redirect: hoisted.redirect, unstable_rethrow: vi.fn() }));

import { approvePolicyAction, createPolicyAction, updatePolicyAction } from "./actions";
import { savePolicyEditAction } from "./policy-edit-actions";

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
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) }));
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
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { body: "Old text", version: 4, owner_id: null }, error: null }) })) })),
      })),
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: returnedPolicy, error: null });
    const selectUpdated = vi.fn(() => ({ maybeSingle }));
    const versionEq = vi.fn(() => ({ select: selectUpdated }));
    const organisationEq = vi.fn(() => ({ eq: versionEq }));
    const idEq = vi.fn(() => ({ eq: organisationEq }));
    const update = vi.fn<(values: Record<string, unknown>) => { eq: typeof idEq }>(() => ({ eq: idEq }));
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValueOnce(read).mockReturnValueOnce({ update });
    hoisted.ctx = {
      supabase: { from, rpc }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID },
      membership: { role: "owner" },
    };
    return { update, versionEq, rpc };
  }

  it("preserves ownership when an edit does not submit an owner field", async () => {
    const { update } = updateContext({ version: 4 });
    const form = policyForm("Old text");
    form.set("expectedVersion", "4");
    form.delete("ownerId");

    await updatePolicyAction(form);

    expect(update.mock.calls[0][0]).not.toHaveProperty("owner_id");
  });

  it.each([{ selection: "", expectedOwner: null }, { selection: USER_ID, expectedOwner: USER_ID }])("honours an explicit owner selection $selection", async ({ selection, expectedOwner }) => {
    const { update } = updateContext({ version: 4 });
    const form = policyForm("Old text");
    form.set("expectedVersion", "4");
    form.set("ownerId", selection);

    await updatePolicyAction(form);

    expect(update.mock.calls[0][0]).toHaveProperty("owner_id", expectedOwner);
  });

  it("uses the expected version and trusts the version returned by the database", async () => {
    const { update, versionEq, rpc } = updateContext({ version: 5 });
    const form = policyForm("New material text");
    form.set("expectedVersion", "4");

    await expect(updatePolicyAction(form)).resolves.toEqual({ version: 5 });

    expect(update).toHaveBeenCalledWith(expect.not.objectContaining({ version: expect.anything() }));
    expect(versionEq).toHaveBeenCalledWith("version", 4);
    expect(rpc).toHaveBeenCalledWith("notify_policy_reaccept", {
      target_policy_id: POLICY_ID,
      note: "Now at version 5.",
    });
  });

  it("returns visible save confirmation only after the policy update succeeds", async () => {
    updateContext({ version: 4 });
    const form = policyForm("Old text");
    form.set("expectedVersion", "4");

    await expect(savePolicyEditAction({}, form)).resolves.toEqual({ success: "Policy changes saved.", version: 4 });
  });

  it("distinguishes a saved policy from a failed re-acceptance notification", async () => {
    const { rpc } = updateContext({ version: 5 });
    rpc.mockResolvedValueOnce({ error: { message: "unavailable" } });
    const form = policyForm("New text");
    form.set("expectedVersion", "4");

    await expect(savePolicyEditAction({}, form)).resolves.toEqual({ error: "The policy was saved, but members could not be notified to re-accept. Check the acceptance roster and follow up with them.", version: 5 });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith(`/app/policies/${POLICY_ID}`);
  });

  it("returns recovery guidance when an edit becomes stale", async () => {
    updateContext(null);
    const form = policyForm("New text");
    form.set("expectedVersion", "4");

    await expect(savePolicyEditAction({}, form)).resolves.toEqual({ error: "This policy changed while you were editing it. Your entries are still shown. Copy them before refreshing, then review the latest policy before saving again." });
  });

  it("reports a stale edit when the expected version no longer matches", async () => {
    updateContext(null);
    const form = policyForm("New material text");
    form.set("expectedVersion", "4");

    await expect(updatePolicyAction(form)).rejects.toThrow("This policy changed while you were editing it");
  });
});
