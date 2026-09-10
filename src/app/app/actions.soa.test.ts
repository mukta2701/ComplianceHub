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
  assessment_sessions: Row[];
  memberships: Row[];
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
  private updateValues: Row | null = null;

  constructor(
    private table: keyof Store,
    private rows: Row[],
    private queries: QueryLog[],
  ) {}

  select() {
    return this;
  }

  update(values: Row) {
    this.updateValues = values;
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
    const result = this.result();
    return Promise.resolve({ data: (result.data as Row[])[0] ?? null, error: result.error });
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

  private result(): Result {
    const data = this.matched();
    if (this.updateValues) {
      for (const row of data) Object.assign(row, this.updateValues);
    }
    return { data, error: null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(store: Store) {
  const queries: QueryLog[] = [];
  const rpc = vi.fn<() => Promise<Result>>(async () => ({ data: "snapshot-1", error: null }));
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
const ASSESSMENT_ID = "00000000-0000-4000-8000-000000000009";
const ITEM_ID = "00000000-0000-4000-8000-000000000005";
const REQUIREMENT_ID = "00000000-0000-4000-8000-000000000006";
const CONTROL_ID = "00000000-0000-4000-8000-000000000007";
const OWNER_ID = "00000000-0000-4000-8000-000000000008";

function formData() {
  const data = new FormData();
  data.set("registerId", REGISTER_ID);
  return data;
}

function assessmentFormData(assessmentId = ASSESSMENT_ID) {
  const data = new FormData();
  data.set("assessmentId", assessmentId);
  return data;
}

function reviewFormData(itemId = ITEM_ID) {
  const data = new FormData();
  data.set("registerId", REGISTER_ID);
  data.set("itemId", itemId);
  data.set("expectedRevision", "0");
  data.set("status", "in_progress");
  data.set("applicable", "true");
  data.set("ownerId", OWNER_ID);
  data.set("justification", "Reviewed rationale");
  data.set("evidence", "Evidence reference");
  return data;
}

function context(client: ReturnType<typeof fakeSupabase>["client"]) {
  return {
    supabase: client,
    user: { id: USER_ID },
    organisation: { id: ORG_ID, name: "Tenant A" },
    membership: { role: "owner" },
  };
}

function reviewedStore(): Store {
  return {
    assessment_sessions: [{ id: ASSESSMENT_ID, organisation_id: ORG_ID }],
    memberships: [{ organisation_id: ORG_ID, user_id: OWNER_ID }],
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
      decision_revision: 0,
    }, ...Array.from({ length: 92 }, (_, i) => ({
      id: `excluded-${i}`, organisation_id: ORG_ID, soa_register_id: REGISTER_ID,
      control_id: `requirement-${i}`, applicable: false, status: "not_applicable",
      justification: "Outside the recorded scope", owner_id: null, decision_revision: 0,
    }))],
    requirement_control_mappings: [{ requirement_id: REQUIREMENT_ID, control_id: CONTROL_ID }],
    evidence_links: [{
      organisation_id: ORG_ID,
      control_id: CONTROL_ID,
      evidence: { status: "expiring" },
    }],
  };
}

describe("createSoaAction active workspace scope", () => {
  it("opens the workspace returned by the atomic review RPC without direct inserts", async () => {
    const fake = fakeSupabase(reviewedStore());
    fake.rpc.mockResolvedValue({ data: REGISTER_ID, error: null });
    hoisted.ctx = context(fake.client);
    const { createSoaAction } = await import("./actions");
    await expect(createSoaAction(assessmentFormData())).rejects.toThrow(`REDIRECT:/app/soa/${REGISTER_ID}`);
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith("create_or_reuse_soa_review", { target_assessment_session_id: ASSESSMENT_ID });
  });

  it("does not redirect when the RPC fails or returns no workspace", async () => {
    const fake = fakeSupabase(reviewedStore());
    fake.rpc.mockResolvedValue({ data: null, error: null });
    hoisted.ctx = context(fake.client);
    const { createSoaAction } = await import("./actions");
    await expect(createSoaAction(assessmentFormData())).rejects.toThrow("Could not start control review");
  });

  it("rejects an assessment id belonging to another organisation before calling the draft RPC", async () => {
    const store = reviewedStore();
    store.assessment_sessions[0] = { id: ASSESSMENT_ID, organisation_id: OTHER_ORG_ID };
    const fake = fakeSupabase(store);
    hoisted.ctx = context(fake.client);
    const { createSoaAction } = await import("./actions");

    await expect(createSoaAction(assessmentFormData())).rejects.toThrow("Assessment not found in the active workspace");
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.queries).toContainEqual({
      table: "assessment_sessions",
      operation: "eq",
      column: "organisation_id",
      value: ORG_ID,
    });
  });
});

describe("createSoaSuccessorAction", () => {
  it("uses the source register contract and opens the returned active workspace", async () => {
    const fake = fakeSupabase(reviewedStore());
    fake.rpc.mockResolvedValue({ data: ASSESSMENT_ID, error: null });
    hoisted.ctx = context(fake.client);
    const { createSoaSuccessorAction } = await import("./actions");
    await expect(createSoaSuccessorAction(formData())).rejects.toThrow(`REDIRECT:/app/soa/${ASSESSMENT_ID}`);
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith("create_or_reuse_soa_successor", { source_register_id: REGISTER_ID });
  });

  it("rejects a source register from another active workspace before invoking the RPC", async () => {
    const store = reviewedStore();
    store.soa_registers[0].organisation_id = OTHER_ORG_ID;
    const fake = fakeSupabase(store);
    hoisted.ctx = context(fake.client);
    const { createSoaSuccessorAction } = await import("./actions");
    await expect(createSoaSuccessorAction(formData())).rejects.toThrow("Finalised statement not found in the active workspace");
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it.each([{ data: null, error: null }, { data: null, error: { message: "private database detail" } }])("handles an unavailable successor without a success redirect", async (result) => {
    const fake = fakeSupabase(reviewedStore());
    fake.rpc.mockResolvedValue(result);
    hoisted.ctx = context(fake.client);
    const { createSoaSuccessorAction } = await import("./actions");
    await expect(createSoaSuccessorAction(formData())).rejects.toThrow("Could not create next control review version");
  });
});

describe("finaliseSoaAction preflight", () => {
  beforeEach(() => {
    hoisted.redirect.mockClear();
  });

  it("reports an incomplete catalogue before calling the finalisation RPC", async () => {
    const store = reviewedStore();
    store.soa_items = store.soa_items.slice(0, 1);
    const fake = fakeSupabase(store);
    hoisted.ctx = context(fake.client);
    const { finaliseSoaAction } = await import("./actions");
    await expect(finaliseSoaAction(formData())).rejects.toThrow("the complete 93-control catalogue is required");
    expect(fake.rpc).not.toHaveBeenCalled();
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

  it("does not expose internal RPC details when finalisation fails", async () => {
    const fake = fakeSupabase(reviewedStore());
    fake.rpc.mockResolvedValue({ data: null, error: { message: "internal finalise policy detail" } });
    hoisted.ctx = context(fake.client);
    const { finaliseSoaAction } = await import("./actions");

    await expect(finaliseSoaAction(formData())).rejects.toThrow("Could not finalise the SoA");
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

describe("reviewSoaItemAction tenant scope", () => {
  it("saves through the guarded command and returns the advanced revision", async () => {
    const fake = fakeSupabase(reviewedStore());
    fake.rpc.mockResolvedValue({ data: [{ item_id: ITEM_ID, decision_revision: 1 }], error: null });
    hoisted.ctx = context(fake.client);
    const { reviewSoaItemAction } = await import("./actions");

    await expect(reviewSoaItemAction(reviewFormData())).resolves.toEqual({ status: "saved", revision: 1 });
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith("update_soa_decisions_guarded", {
      target_register_id: REGISTER_ID,
      changes: [{
        itemId: ITEM_ID,
        expectedRevision: 0,
        applicable: true,
        status: "in_progress",
        justification: "Reviewed rationale",
        evidence: "Evidence reference",
        ownerId: OWNER_ID,
      }],
    });
  });

  it.each([
    [{ code: "PT409", message: "control_decision_stale", details: "revision_mismatch" }, { status: "stale", message: "This control changed after you opened it. Refresh and reconcile your draft before saving again." }],
    [{ code: "P0002", message: "control_decision_missing", details: "item_unavailable" }, { status: "missing", message: "This control is no longer available. Refresh the review before saving again." }],
    [{ code: "42501", message: "control_decision_forbidden", details: "register_unavailable" }, { status: "forbidden", message: "You cannot update this control review. Refresh to check your current access and review state." }],
    [{ code: "22023", message: "control_decision_invalid", details: "owner_unavailable" }, { status: "forbidden", message: "This decision is no longer valid. Refresh and check the control owner before saving again." }],
  ])("maps guarded database outcomes to recoverable results without leaking details", async (error, expected) => {
    const fake = fakeSupabase(reviewedStore());
    fake.rpc.mockResolvedValue({ data: null, error });
    hoisted.ctx = context(fake.client);
    const { reviewSoaItemAction } = await import("./actions");

    await expect(reviewSoaItemAction(reviewFormData())).resolves.toEqual(expected);
  });

  it("does not turn an empty guarded response into a successful save", async () => {
    const fake = fakeSupabase(reviewedStore());
    fake.rpc.mockResolvedValue({ data: [], error: null });
    hoisted.ctx = context(fake.client);
    const { reviewSoaItemAction } = await import("./actions");

    await expect(reviewSoaItemAction(reviewFormData())).resolves.toEqual({
      status: "missing",
      message: "This control is no longer available. Refresh the review before saving again.",
    });
  });

  it("does not let a dual-membership operator mutate a sibling register while another workspace is active", async () => {
    const store = reviewedStore();
    store.soa_registers[0] = { id: REGISTER_ID, organisation_id: OTHER_ORG_ID };
    store.memberships.push(
      { organisation_id: ORG_ID, user_id: USER_ID, role: "owner" },
      { organisation_id: OTHER_ORG_ID, user_id: USER_ID, role: "owner" },
    );
    const fake = fakeSupabase(store);
    hoisted.ctx = context(fake.client);
    const { reviewSoaItemAction } = await import("./actions");

    await expect(reviewSoaItemAction(reviewFormData())).resolves.toEqual({
      status: "forbidden",
      message: "You cannot update this control review. Refresh to check your current access and review state.",
    });
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.queries).toContainEqual({
      table: "soa_registers",
      operation: "eq",
      column: "organisation_id",
      value: ORG_ID,
    });
  });
});
