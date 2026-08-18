import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "78000000-0000-4000-8000-000000000003";
const SIBLING_ORG_ID = "78000000-0000-4000-8000-000000000004";
const USER_ID = "78000000-0000-4000-8000-000000000002";
const POLICY_ID = "78000000-0000-4000-8000-000000000001";
const LINK_ID = "78000000-0000-4000-8000-000000000005";

type QueryBuilder = {
  select: () => QueryBuilder;
  update: (value: unknown) => QueryBuilder;
  delete: () => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  single: () => Promise<{ data: unknown; error: null }>;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};

const hoisted = vi.hoisted(() => ({ ctx: null as unknown, writes: [] as unknown[] }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

import { acceptPolicyAction, approvePolicyAction, setPolicyStatusAction, updatePolicyAction } from "./actions";
import { unlinkPolicyEvidenceAction } from "./[id]/evidence-actions";

function policyForm() {
  const form = new FormData();
  form.set("id", POLICY_ID);
  form.set("reference", "POL-001");
  form.set("title", "Security policy");
  form.set("body", "Updated policy text");
  form.set("ownerId", "");
  form.set("reviewDue", "");
  form.set("expectedVersion", "1");
  return form;
}

function fakeSupabase() {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();
      let operation: "read" | "update" | "delete" = "read";
      let payload: unknown;
      const builder = {} as QueryBuilder;
      Object.assign(builder, {
        select: () => builder,
        update: (value: unknown) => { operation = "update"; payload = value; return builder; },
        delete: () => { operation = "delete"; return builder; },
        eq: (column: string, value: unknown) => { filters.set(column, value); return builder; },
        single: async () => ({
          data: table === "policies" && !filters.has("organisation_id")
            ? { body: "Sibling policy", version: 1, owner_id: null }
            : null,
          error: null,
        }),
        maybeSingle: async () => {
          if (operation === "read" && table === "policies") {
            return { data: filters.has("organisation_id") ? null : { id: POLICY_ID }, error: null };
          }
          if (operation === "update") {
            const belongsToActiveOrg = filters.get("organisation_id") === ORG_ID;
            if (!belongsToActiveOrg) hoisted.writes.push({ table, operation, payload, filters: new Map(filters) });
            return { data: belongsToActiveOrg ? null : { version: 2 }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => {
          const belongsToActiveOrg = filters.get("organisation_id") === ORG_ID;
          if (operation === "update" && !belongsToActiveOrg) hoisted.writes.push({ table, operation, payload, filters: new Map(filters) });
          if (operation === "delete" && !belongsToActiveOrg) hoisted.writes.push({ table, operation, filters: new Map(filters) });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      });
      return builder;
    },
    rpc: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe("policy mutations stay in the active workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.writes.length = 0;
    hoisted.ctx = {
      supabase: fakeSupabase(),
      user: { id: USER_ID },
      organisation: { id: ORG_ID },
      membership: { role: "owner" },
    };
  });

  it("rejects a sibling policy update before writing", async () => {
    await expect(updatePolicyAction(policyForm())).rejects.toThrow("Policy not found");
    expect(hoisted.writes).toEqual([]);
  });

  it("does not approve a sibling policy", async () => {
    const form = new FormData();
    form.set("id", POLICY_ID);
    await expect(approvePolicyAction(form)).resolves.toBeUndefined();
    expect(hoisted.writes).toEqual([]);
  });

  it("does not change the status of a sibling policy", async () => {
    const form = new FormData();
    form.set("id", POLICY_ID);
    form.set("status", "approved");
    await expect(setPolicyStatusAction(form)).resolves.toBeUndefined();
    expect(hoisted.writes).toEqual([]);
  });

  it("does not accept a sibling policy", async () => {
    const form = new FormData();
    form.set("id", POLICY_ID);
    await expect(acceptPolicyAction(form)).rejects.toThrow("Policy not found");
    const context = hoisted.ctx as { supabase: { rpc: ReturnType<typeof vi.fn> } };
    expect(context.supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("policy evidence unlink workspace boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.writes.length = 0;
    hoisted.ctx = {
      supabase: fakeSupabase(),
      user: { id: USER_ID },
      organisation: { id: ORG_ID },
      membership: { role: "owner" },
    };
  });

  it("does not unlink a sibling organisation's evidence link", async () => {
    const form = new FormData();
    form.set("policyId", POLICY_ID);
    form.set("linkId", LINK_ID);
    await expect(unlinkPolicyEvidenceAction(form)).resolves.toBeUndefined();
    expect(hoisted.writes).toEqual([]);
  });
});

void SIBLING_ORG_ID;
