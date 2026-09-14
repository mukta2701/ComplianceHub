import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  revalidatePath: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

const POLICY_ID = "11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "22222222-2222-4222-8222-222222222222";
const LINK_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));

import { linkPolicyEvidenceAction } from "./evidence-actions";

function evidenceForm() {
  const form = new FormData();
  form.set("policyId", POLICY_ID);
  form.set("evidenceId", EVIDENCE_ID);
  return form;
}

function unlinkForm() {
  const form = evidenceForm();
  form.set("linkId", LINK_ID);
  return form;
}

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  then?: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};

function supabaseFixture({ sibling = false } = {}) {
  const queries: Array<{ table: string; column: string; value: unknown }> = [];
  const deleted = vi.fn().mockResolvedValue({ error: null });
  const inserted = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    const equals: Array<[string, unknown]> = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        equals.push([column, value]);
        queries.push({ table, column, value });
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        const expectedOrg = equals.find(([column]) => column === "organisation_id")?.[1];
        const id = equals.find(([column]) => column === "id")?.[1];
        if (table === "policies" && id === POLICY_ID && expectedOrg === "org-1" && !sibling) return { data: { id }, error: null };
        if (table === "evidence" && id === EVIDENCE_ID && expectedOrg === "org-1" && !sibling) return { data: { id }, error: null };
        if (table === "evidence_links" && id === LINK_ID && expectedOrg === "org-1" && equals.some(([column, value]) => column === "policy_id" && value === POLICY_ID) && !sibling) return { data: { id }, error: null };
        return { data: null, error: null };
      }),
      insert: inserted,
      delete: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
      })),
    } as unknown as QueryBuilder;
    const deleteBuilder = (builder.delete as unknown as () => QueryBuilder)();
    deleteBuilder.eq = vi.fn(() => deleteBuilder);
    deleteBuilder.then = (resolve: (value: unknown) => unknown) => deleted().then(resolve);
    builder.delete = vi.fn(() => deleteBuilder);
    return builder;
  });
  return { supabase: { from }, from, queries, inserted, deleted };
}

describe("policy evidence management access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.enforceRateLimit.mockResolvedValue(undefined);
  });

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
      const fixture = supabaseFixture();
      hoisted.ctx = {
        supabase: fixture.supabase, user: { id: "user-1" },
        organisation: { id: "org-1" }, membership: { role },
      };

      await expect(linkPolicyEvidenceAction(evidenceForm())).resolves.toBeUndefined();
      expect(fixture.inserted).toHaveBeenCalledOnce();
      expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(`policy-evidence:org-1:user-1:${POLICY_ID}`, { limit: 30, windowMs: 60_000 });
    });
  }

  it("rejects a policy or evidence record outside the active workspace before linking", async () => {
    const fixture = supabaseFixture({ sibling: true });
    hoisted.ctx = { supabase: fixture.supabase, user: { id: "user-1" }, organisation: { id: "org-1" }, membership: { role: "owner" } };

    await expect(linkPolicyEvidenceAction(evidenceForm())).rejects.toThrow("Policy or evidence not found in the active workspace");
    expect(fixture.inserted).not.toHaveBeenCalled();
  });

  it("scopes unlink preflight and delete to the selected policy and active workspace", async () => {
    const fixture = supabaseFixture();
    hoisted.ctx = { supabase: fixture.supabase, user: { id: "user-1" }, organisation: { id: "org-1" }, membership: { role: "owner" } };

    const { unlinkPolicyEvidenceAction } = await import("./evidence-actions");
    await expect(unlinkPolicyEvidenceAction(unlinkForm())).resolves.toBeUndefined();
    expect(fixture.queries).toEqual(expect.arrayContaining([
      { table: "evidence_links", column: "organisation_id", value: "org-1" },
      { table: "evidence_links", column: "policy_id", value: POLICY_ID },
    ]));
    expect(fixture.deleted).toHaveBeenCalledOnce();
    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(`policy-evidence:org-1:user-1:${POLICY_ID}`, { limit: 30, windowMs: 60_000 });
  });

  it("rejects unlinking a link bound to a different policy", async () => {
    const fixture = supabaseFixture({ sibling: true });
    hoisted.ctx = { supabase: fixture.supabase, user: { id: "user-1" }, organisation: { id: "org-1" }, membership: { role: "owner" } };

    const { unlinkPolicyEvidenceAction } = await import("./evidence-actions");
    await expect(unlinkPolicyEvidenceAction(unlinkForm())).rejects.toThrow("Evidence link was not found in this policy");
    expect(fixture.deleted).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before rate limiting or database access", async () => {
    const fixture = supabaseFixture();
    hoisted.ctx = { supabase: fixture.supabase, user: { id: "user-1" }, organisation: { id: "org-1" }, membership: { role: "owner" } };
    const malformed = evidenceForm();
    malformed.set("policyId", "not-a-uuid");

    await expect(linkPolicyEvidenceAction(malformed)).rejects.toThrow();
    expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
    expect(fixture.queries).toHaveLength(0);
  });
});
