import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: hoisted.redirect }));

type Row = Record<string, unknown>;
type Store = {
  soa_registers: Row[];
  soa_items: Row[];
  requirement_control_mappings: Row[];
  evidence_links: Row[];
};
type QueryLog = { table: keyof Store; operation: "eq" | "in"; column: string; value: unknown };
type Result = { data: unknown; error: unknown };

class Builder implements PromiseLike<Result> {
  private equals: [string, unknown][] = [];
  private inclusions: [string, unknown[]][] = [];

  constructor(
    private table: keyof Store,
    private rows: Row[],
    private queries: QueryLog[],
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.equals.push([column, value]);
    this.queries.push({ table: this.table, operation: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.inclusions.push([column, value]);
    this.queries.push({ table: this.table, operation: "in", column, value });
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.matched()[0] ?? null, error: null });
  }

  single() {
    return this.maybeSingle();
  }

  private matched() {
    return this.rows.filter((row) => (
      this.equals.every(([column, value]) => row[column] === value)
      && this.inclusions.every(([column, values]) => values.includes(row[column]))
    ));
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve({ data: this.matched(), error: null }).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(store: Store) {
  const queries: QueryLog[] = [];
  const rpc = vi.fn(async () => ({ data: "snapshot-1", error: null }));
  return {
    client: {
      from: (table: keyof Store) => new Builder(table, store[table], queries),
      rpc,
    },
    queries,
    rpc,
  };
}

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const REGISTER_ID = "00000000-0000-4000-8000-000000000004";
const ITEM_ID = "00000000-0000-4000-8000-000000000005";
const REQUIREMENT_ID = "00000000-0000-4000-8000-000000000006";
const CONTROL_ID = "00000000-0000-4000-8000-000000000007";
const OWNER_ID = "00000000-0000-4000-8000-000000000008";

function formData() {
  const data = new FormData();
  data.set("registerId", REGISTER_ID);
  return data;
}

function context(client: ReturnType<typeof fakeSupabase>["client"]) {
  return {
    supabase: client,
    user: { id: USER_ID },
    organisation: { id: ORG_ID, name: "Tenant A" },
  };
}

function reviewedStore(): Store {
  return {
    soa_registers: [{ id: REGISTER_ID, organisation_id: ORG_ID }],
    soa_items: [{
      id: ITEM_ID,
      organisation_id: ORG_ID,
      soa_register_id: REGISTER_ID,
      control_id: REQUIREMENT_ID,
      applicable: true,
      status: "operational",
      justification: "Reviewed rationale",
      owner_id: OWNER_ID,
    }],
    requirement_control_mappings: [{ requirement_id: REQUIREMENT_ID, control_id: CONTROL_ID }],
    evidence_links: [{
      organisation_id: ORG_ID,
      control_id: CONTROL_ID,
      evidence: { status: "expiring" },
    }],
  };
}

describe("finaliseSoaAction preflight", () => {
  beforeEach(() => {
    hoisted.redirect.mockClear();
  });

  it("rejects review blockers before calling the finalisation RPC", async () => {
    const store = reviewedStore();
    store.soa_items[0] = {
      ...store.soa_items[0],
      status: "pending",
      justification: " ",
      owner_id: null,
    };
    store.evidence_links = [{
      organisation_id: ORG_ID,
      control_id: CONTROL_ID,
      evidence: { status: "expired" },
    }];
    const fake = fakeSupabase(store);
    hoisted.ctx = context(fake.client);
    const { finaliseSoaAction } = await import("./actions");

    await expect(finaliseSoaAction(formData())).rejects.toThrow("SoA cannot be finalised");
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("derives tenant scope from app context and cannot target another organisation", async () => {
    const store = reviewedStore();
    store.soa_registers[0] = { id: REGISTER_ID, organisation_id: OTHER_ORG_ID };
    const fake = fakeSupabase(store);
    hoisted.ctx = context(fake.client);
    const { finaliseSoaAction } = await import("./actions");

    await expect(finaliseSoaAction(formData())).rejects.toThrow("SoA register not found");
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.queries).toContainEqual({
      table: "soa_registers",
      operation: "eq",
      column: "organisation_id",
      value: ORG_ID,
    });
  });

  it("calls the RPC only after current or expiring mapped evidence satisfies preflight", async () => {
    const fake = fakeSupabase(reviewedStore());
    hoisted.ctx = context(fake.client);
    const { finaliseSoaAction } = await import("./actions");

    await expect(finaliseSoaAction(formData())).rejects.toThrow("REDIRECT:/app/soa?finalised=snapshot-1");
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith("finalise_soa", { target_register_id: REGISTER_ID });
  });

  it("rejects a requirement that has both current and expired evidence", async () => {
    const store = reviewedStore();
    store.evidence_links = [
      { organisation_id: ORG_ID, control_id: CONTROL_ID, evidence: { status: "current" } },
      { organisation_id: ORG_ID, control_id: CONTROL_ID, evidence: { status: "expired" } },
    ];
    const fake = fakeSupabase(store);
    hoisted.ctx = context(fake.client);
    const { finaliseSoaAction } = await import("./actions");

    await expect(finaliseSoaAction(formData())).rejects.toThrow("SoA cannot be finalised");
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});
