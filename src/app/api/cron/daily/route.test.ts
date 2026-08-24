import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route is server-only automation code. Rather than depend on a live
// Supabase/env (no DB-integration harness exists in this repo, and unit tests
// must stay env-free), we mock the service client with an in-memory fake that
// enforces the same unique constraints as Postgres. Upserts check-then-insert
// synchronously inside a single microtask, so `ignoreDuplicates` is atomic per
// key — faithfully modelling the day-scoped notification and evidence-expiry
// task constraints that make the sweep idempotent across retries and concurrent
// invocations.

const hoisted = vi.hoisted(() => ({
  client: null as unknown,
  buildMaterialisation: vi.fn(),
  reconcileMaterialisation: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => hoisted.client,
}));
vi.mock("@/features/github/application/materialise-approved-observations", () => ({
  buildMaterialisationDependencies: hoisted.buildMaterialisation,
  reconcileApprovedGitHubObservations: hoisted.reconcileMaterialisation,
}));

type Row = Record<string, unknown>;

type Store = {
  evidence: Row[];
  tasks: Row[];
  notifications: Row[];
  memberships: Row[];
  policies: Row[];
  evidence_sources: Row[];
  task_tickets: Row[];
};

type Filter =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "in"; col: string; vals: unknown[] }
  | { kind: "notNull"; col: string }
  | { kind: "isNull"; col: string }
  | { kind: "gt"; col: string; val: unknown }
  | { kind: "lt"; col: string; val: unknown };

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.kind === "eq") return row[f.col] === f.val;
    if (f.kind === "in") return f.vals.includes(row[f.col]);
    if (f.kind === "notNull") return row[f.col] !== null && row[f.col] !== undefined;
    if (f.kind === "isNull") return row[f.col] === null || row[f.col] === undefined;
    if (f.kind === "gt") return (row[f.col] as string) > (f.val as string);
    return (row[f.col] as string) < (f.val as string);
  });
}

class Builder implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: "select" | "update" | "upsert" = "select";
  private filters: Filter[] = [];
  private payload: Row = {};
  private upsertKeys: string[] = [];
  private isSingle = false;
  private isMaybeSingle = false;
  private orderColumn: string | null = null;
  private resultLimit: number | null = null;

  constructor(private store: Store, private table: keyof Store) {}

  private get rows(): Row[] {
    return this.store[this.table];
  }

  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ kind: "eq", col, val });
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push({ kind: "in", col, vals });
    return this;
  }
  not(col: string) {
    // Modelled only for `.not(col, "is", null)`, i.e. a not-null filter.
    this.filters.push({ kind: "notNull", col });
    return this;
  }
  is(col: string, val: null) {
    void val;
    // Modelled only for `.is(col, null)`, i.e. an is-null filter.
    this.filters.push({ kind: "isNull", col });
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push({ kind: "lt", col, val });
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push({ kind: "gt", col, val });
    return this;
  }
  order(col: string) {
    this.orderColumn = col;
    return this;
  }
  limit(value: number) {
    this.resultLimit = value;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row, options: { onConflict: string; ignoreDuplicates: boolean }) {
    this.op = "upsert";
    this.payload = payload;
    this.upsertKeys = options.onConflict.split(",");
    return this;
  }
  single() {
    this.isSingle = true;
    return this;
  }
  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  private resolve(): { data: unknown; error: unknown } {
    if (this.op === "update") {
      for (const row of this.rows.filter((r) => matches(r, this.filters))) Object.assign(row, this.payload);
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      const duplicate = this.rows.find((r) => this.upsertKeys.every((k) => r[k] === this.payload[k]));
      if (duplicate) return { data: [], error: null };
      const inserted = { id: nextId(this.table as string), ...this.payload };
      this.rows.push(inserted);
      return { data: [{ id: inserted.id }], error: null };
    }
    let found = this.rows.filter((r) => matches(r, this.filters));
    if (this.orderColumn) {
      const col = this.orderColumn;
      found = [...found].sort((left, right) => String(left[col]).localeCompare(String(right[col])));
    }
    // Match the local/hosted Data API ceiling so missing pagination fails in
    // unit tests instead of silently passing against the in-memory store.
    found = found.slice(0, this.resultLimit ?? 1_000);
    if (this.isSingle) {
      if (found.length === 0) return { data: null, error: { message: "no rows" } };
      return { data: found[0], error: null };
    }
    if (this.isMaybeSingle) {
      return { data: found[0] ?? null, error: null };
    }
    return { data: found, error: null };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

function createFakeClient(store: Store) {
  return {
    from: (table: keyof Store) => new Builder(store, table),
    rpc: vi.fn(async () => ({ data: 0, error: null })),
  };
}

function seed(): Store {
  idCounter = 0;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);
  return {
    memberships: [{ organisation_id: "org-1", user_id: "owner-1", role: "owner" }],
    evidence: [
      { id: "ev-1", organisation_id: "org-1", title: "Backup report", owner_id: "owner-1", status: "current", valid_until: yesterdayIso },
    ],
    tasks: [
      { id: "task-1", organisation_id: "org-1", title: "Fix firewall", owner_id: "owner-1", status: "open", due_on: yesterdayIso, source: "manual", evidence_id: null, policy_id: null },
    ],
    notifications: [],
    policies: [
      { id: "pol-1", organisation_id: "org-1", reference: "POL-001", title: "Access control", owner_id: "owner-1", status: "approved", review_due: yesterdayIso },
    ],
    // No evidence sources or ticket connections wired up in this fixture —
    // collectEvidence/syncTickets run against an empty set and are no-ops,
    // exercising the new pipeline stages without changing sweep behaviour.
    evidence_sources: [],
    task_tickets: [],
  };
}

function request(token: string): Request {
  return new Request("http://localhost/api/cron/daily", { headers: { authorization: `Bearer ${token}` } });
}

let store: Store;
let GET: (request: Request) => Promise<Response>;

beforeEach(async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  store = seed();
  hoisted.client = createFakeClient(store);
  hoisted.buildMaterialisation.mockReset().mockReturnValue({ dependency: "materialisation" });
  hoisted.reconcileMaterialisation.mockReset().mockResolvedValue({
    runsConsidered: 1,
    materialised: 0,
    unchanged: 1,
    awaitingApproval: 0,
    needsAttention: 0,
  });
  ({ GET } = await import("./route"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const expiryTasks = () => store.tasks.filter((t) => t.source === "evidence_expiry");
const policyReviewTasks = () => store.tasks.filter((t) => t.source === "policy_review");

describe("GET /api/cron/daily", () => {
  it("moves evidence to expired, raises exactly one expiry task, and notifies the owner", async () => {
    const response = await GET(request("test-secret"));
    expect(response.status).toBe(200);
    const summary = await response.json();

    expect(store.evidence[0].status).toBe("expired");
    expect(expiryTasks()).toHaveLength(1);
    expect(store.notifications.some((n) => n.user_id === "owner-1" && n.kind === "evidence_expired")).toBe(true);
    expect(store.notifications.some((n) => n.user_id === "owner-1" && n.kind === "task_overdue")).toBe(true);
    // Response shape changed under Task 10: the sweep summary now lives under
    // `.sweep`, alongside the new `.collect` and `.sync` pipeline stages.
    expect(summary.sweep.evidenceExpired).toBe(1);
    // One evidence-expiry task and one policy-review task were raised.
    expect(summary.sweep.tasksCreated).toBe(2);
    expect(summary.collect).toEqual({ collected: 0, refreshed: 0, failed: 0 });
    expect(summary.sync).toEqual({ synced: 0, failed: 0, tasksClosed: 0 });
    expect(summary.digestRecovery).toEqual({ classifiedUnknown: 0, limitReached: false });
    expect(summary.githubMaterialisation).toEqual({
      runsConsidered: 1,
      materialised: 0,
      unchanged: 1,
      awaitingApproval: 0,
      needsAttention: 0,
    });
    expect(hoisted.reconcileMaterialisation).toHaveBeenCalledWith(
      { dependency: "materialisation" },
      { limit: 20 },
    );
  });

  it("raises exactly one policy_review task for the due policy and notifies the owner", async () => {
    const response = await GET(request("test-secret"));
    expect(response.status).toBe(200);

    const reviewTasks = policyReviewTasks();
    expect(reviewTasks).toHaveLength(1);
    expect(reviewTasks[0].policy_id).toBe("pol-1");
    expect(store.notifications.some((n) => n.user_id === "owner-1" && n.kind === "policy_review" && n.subject_id === "pol-1")).toBe(true);
  });

  it("does not re-raise a policy_review task when one is already open", async () => {
    store.tasks.push({ id: "task-2", organisation_id: "org-1", title: "Existing review", owner_id: "owner-1", status: "open", due_on: null, source: "policy_review", evidence_id: null, policy_id: "pol-1" });
    await GET(request("test-secret"));
    // Still only the pre-existing open review task; the sweep raised no duplicate.
    expect(policyReviewTasks()).toHaveLength(1);
  });

  it("stays idempotent when two sweeps run concurrently", async () => {
    await Promise.all([GET(request("test-secret")), GET(request("test-secret"))]);

    expect(store.evidence[0].status).toBe("expired");
    expect(expiryTasks()).toHaveLength(1);
    // Every notification key (user_id, kind, subject_type, subject_id, sweep_on) is unique.
    const keys = store.notifications.map((n) => [n.user_id, n.kind, n.subject_type, n.subject_id, n.sweep_on].join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("paginates every workspace Owner beyond the Supabase row ceiling", async () => {
    store.memberships = Array.from({ length: 1_205 }, (_, index) => ({
      organisation_id: "org-1",
      user_id: `owner-${String(index + 1).padStart(4, "0")}`,
      role: "owner",
    }));
    store.evidence[0].owner_id = null;
    store.tasks[0].owner_id = null;
    store.policies[0].owner_id = null;

    const response = await GET(request("test-secret"));
    expect(response.status).toBe(200);

    const overdueRecipients = new Set(store.notifications
      .filter((row) => row.kind === "task_overdue")
      .map((row) => row.user_id));
    expect(overdueRecipients.size).toBe(1_205);
    expect(overdueRecipients.has("owner-1205")).toBe(true);
  });

  it("rejects a wrong bearer token with 401 and touches no state", async () => {
    const response = await GET(request("wrong-secret"));
    expect(response.status).toBe(401);
    expect(store.evidence[0].status).toBe("current");
    expect(expiryTasks()).toHaveLength(0);
    expect(store.notifications).toHaveLength(0);
    expect(hoisted.reconcileMaterialisation).not.toHaveBeenCalled();
  });

  it("isolates a bounded GitHub materialisation recovery failure from the existing daily sweep", async () => {
    hoisted.reconcileMaterialisation.mockRejectedValue(new Error("private RPC body"));

    const response = await GET(request("test-secret"));
    const summary = await response.json();

    expect(response.status).toBe(200);
    expect(summary.githubMaterialisation).toEqual({ error: "githubMaterialisation failed" });
    expect(summary.sweep.evidenceExpired).toBe(1);
  });
});
