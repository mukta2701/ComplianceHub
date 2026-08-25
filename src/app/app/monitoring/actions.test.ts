import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  createServiceClient: vi.fn(),
  runMonitoring: vi.fn(),
  enforceRateLimit: vi.fn(),
  encryptSecret: vi.fn((value: string | null) => value),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve(hoisted.ctx),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: hoisted.createServiceClient,
}));
vi.mock("@/features/monitoring/application/monitor-deps", () => ({
  buildMonitorDependencies: vi.fn(),
}));
vi.mock("@/features/monitoring/application/monitor-run", () => ({
  runMonitoring: hoisted.runMonitoring,
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/security/secrets", () => ({ encryptSecret: hoisted.encryptSecret }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  acknowledgeFindingAction,
  fetchRecentAlertsAction,
  raiseTaskFromFindingAction,
  resolveFindingAction,
  runMonitoringNowAction,
  transitionGitHubFindingAction,
} from "./actions";

describe("runMonitoringNowAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.ctx = {
      membership: { role: "member" },
      organisation: { id: "20000000-0000-4000-8000-000000000001" },
    };
  });

  it("rejects members before constructing a service-role client", async () => {
    await expect(runMonitoringNowAction()).rejects.toThrow("Only workspace operators can run monitoring");

    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
    expect(hoisted.runMonitoring).not.toHaveBeenCalled();
  });

  for (const role of ["owner", "admin"] as const) {
    it(`allows ${role}s to run monitoring`, async () => {
      hoisted.ctx = { membership: { role }, user: { id: "user-1" }, organisation: { id: "20000000-0000-4000-8000-000000000001" } };
      hoisted.createServiceClient.mockReturnValue({ service: true });
      hoisted.runMonitoring.mockResolvedValue(undefined);

      await expect(runMonitoringNowAction()).resolves.toBeUndefined();

      expect(hoisted.createServiceClient).toHaveBeenCalledOnce();
      expect(hoisted.runMonitoring).toHaveBeenCalledOnce();
      expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(
        "monitoring:20000000-0000-4000-8000-000000000001:user-1",
        { limit: 5, windowMs: 60_000 },
      );
    });
  }
});

describe("monitoring finding mutations", () => {
  it.each([
    ["acknowledge", acknowledgeFindingAction],
    ["raise a task from", raiseTaskFromFindingAction],
    ["resolve", resolveFindingAction],
  ] as const)("rejects Admin callers before attempting to %s a finding", async (_label, action) => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from },
      user: { id: "user-1" },
      organisation: { id: "org-1" },
      membership: { role: "admin" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");

    await expect(action(form)).rejects.toThrow("Only workspace owners can manage monitoring findings");
    expect(from).not.toHaveBeenCalled();
  });

  it("scopes acknowledgement to the active organisation and fails closed on no match", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.update = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: "user-1" }, organisation: { id: "org-1" },
      membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");

    await expect(acknowledgeFindingAction(form)).rejects.toThrow("Finding was not found in this workspace");
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", "org-1");
  });

  it("raises and links a remediation task through the atomic owner RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "task-1", error: null });
    hoisted.ctx = {
      supabase: { rpc }, user: { id: "user-1" }, organisation: { id: "org-1" },
      membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");

    await expect(raiseTaskFromFindingAction(form)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("raise_monitoring_finding_task", {
      target_organisation_id: "org-1",
      target_finding_id: "10000000-0000-4000-8000-000000000099",
      target_owner_id: "user-1",
    });
  });

  it("treats an already-linked finding as an idempotent no-op", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });
    hoisted.ctx = {
      supabase: { rpc }, user: { id: "user-1" }, organisation: { id: "org-1" },
      membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "10000000-0000-4000-8000-000000000099");

    await expect(raiseTaskFromFindingAction(form)).resolves.toBeUndefined();
  });
});

describe("recent monitoring alerts active workspace scope", () => {
  it("filters the signed-in user's alerts to the active organisation", async () => {
    const result = {
      data: [{
        id: 42,
        message: "Branch protection changed",
        kind: "control_drift",
        created_at: "2026-07-14T08:00:00.000Z",
      }],
    };
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "in", "order"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.limit = vi.fn().mockResolvedValue(result);
    const from = vi.fn(() => builder);
    hoisted.ctx = {
      supabase: { from },
      organisation: { id: "20000000-0000-4000-8000-000000000001" },
      membership: { role: "member" },
    };

    await expect(fetchRecentAlertsAction()).resolves.toEqual([{
      id: 42,
      message: "Branch protection changed",
      kind: "control_drift",
      createdAt: "2026-07-14T08:00:00.000Z",
    }]);

    expect(from).toHaveBeenCalledWith("notifications");
    expect(builder.eq).toHaveBeenCalledWith(
      "organisation_id",
      "20000000-0000-4000-8000-000000000001",
    );
  });
});

describe("official GitHub finding transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function exactQuery(result: { data: unknown; error: unknown }) {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue(result);
    return builder;
  }

  it("rejects malformed input before any database, limiter, or service work", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: "10000000-0000-4000-8000-000000000001" },
      organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "not-a-uuid");
    form.set("status", "resolved");

    await expect(transitionGitHubFindingAction(form)).resolves.toEqual({
      ok: false,
      message: "Choose a valid GitHub finding transition.",
    });
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
  });

  it("keeps Admin and Member callers read-only before exact-record lookup", async () => {
    for (const role of ["admin", "member"] as const) {
      const from = vi.fn();
      hoisted.ctx = {
        supabase: { from }, user: { id: "10000000-0000-4000-8000-000000000001" },
        organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role },
      };
      const form = new FormData();
      form.set("id", "40000000-0000-4000-8000-000000000001");
      form.set("status", "acknowledged");

      await expect(transitionGitHubFindingAction(form)).resolves.toEqual({
        ok: false,
        message: "Only workspace Owners can review official GitHub findings.",
      });
      expect(from).not.toHaveBeenCalled();
    }
  });

  it("rejects sibling or legacy IDs before rate limiting or service construction", async () => {
    for (const finding of [null, { id: "40000000-0000-4000-8000-000000000001", status: "open", finding_origin: "legacy" }]) {
      const findingQuery = exactQuery({ data: finding, error: null });
      const from = vi.fn(() => findingQuery);
      hoisted.ctx = {
        supabase: { from }, user: { id: "10000000-0000-4000-8000-000000000001" },
        organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role: "owner" },
      };
      const form = new FormData();
      form.set("id", "40000000-0000-4000-8000-000000000001");
      form.set("status", "acknowledged");

      await expect(transitionGitHubFindingAction(form)).resolves.toEqual({
        ok: false,
        message: "Official GitHub finding was not found in this workspace.",
      });
      expect(findingQuery.eq).toHaveBeenCalledWith("organisation_id", "20000000-0000-4000-8000-000000000001");
      expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
      expect(hoisted.createServiceClient).not.toHaveBeenCalled();
    }
  });

  it("preflights exact active-workspace provenance, rate limits, then calls the service-only transition RPC with a closed reason", async () => {
    const order: string[] = [];
    const findingQuery = exactQuery({ data: { id: "40000000-0000-4000-8000-000000000001", status: "open", finding_origin: "github" }, error: null });
    const provenanceQuery = exactQuery({ data: { finding_id: "40000000-0000-4000-8000-000000000001" }, error: null });
    findingQuery.maybeSingle.mockImplementation(async () => { order.push("finding"); return { data: { id: "40000000-0000-4000-8000-000000000001", status: "open", finding_origin: "github" }, error: null }; });
    provenanceQuery.maybeSingle.mockImplementation(async () => { order.push("provenance"); return { data: { finding_id: "40000000-0000-4000-8000-000000000001" }, error: null }; });
    const from = vi.fn((table: string) => table === "monitoring_findings" ? findingQuery : provenanceQuery);
    hoisted.enforceRateLimit.mockImplementation(async () => { order.push("limit"); });
    const rpc = vi.fn(async () => { order.push("service"); return { data: true, error: null }; });
    hoisted.createServiceClient.mockImplementation(() => { order.push("construct-service"); return { rpc }; });
    hoisted.ctx = {
      supabase: { from }, user: { id: "10000000-0000-4000-8000-000000000001" },
      organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("id", "40000000-0000-4000-8000-000000000001");
    form.set("status", "in_progress");

    await expect(transitionGitHubFindingAction(form)).resolves.toEqual({
      ok: true,
      message: "GitHub finding moved to In progress.",
    });
    expect(order).toEqual(["finding", "provenance", "limit", "construct-service", "service"]);
    expect(rpc).toHaveBeenCalledWith("transition_github_finding_server", {
      target_organisation_id: "20000000-0000-4000-8000-000000000001",
      target_actor_id: "10000000-0000-4000-8000-000000000001",
      target_finding_id: "40000000-0000-4000-8000-000000000001",
      target_status: "in_progress",
      target_reason: "remediation_started",
    });
  });

  it("maps database detail to one stable client-safe error", async () => {
    const findingQuery = exactQuery({ data: { id: "40000000-0000-4000-8000-000000000001", status: "open", finding_origin: "github" }, error: null });
    const provenanceQuery = exactQuery({ data: { finding_id: "40000000-0000-4000-8000-000000000001" }, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn((table: string) => table === "monitoring_findings" ? findingQuery : provenanceQuery) },
      user: { id: "10000000-0000-4000-8000-000000000001" }, organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role: "owner" },
    };
    hoisted.createServiceClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "private database detail" } }) });
    const form = new FormData();
    form.set("id", "40000000-0000-4000-8000-000000000001");
    form.set("status", "risk_accepted");

    await expect(transitionGitHubFindingAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not update the official GitHub finding.",
    });
  });

  it("reports a concurrent already-applied transition as an idempotent no-op", async () => {
    const findingQuery = exactQuery({ data: { id: "40000000-0000-4000-8000-000000000001", status: "open", finding_origin: "github" }, error: null });
    const provenanceQuery = exactQuery({ data: { finding_id: "40000000-0000-4000-8000-000000000001" }, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn((table: string) => table === "monitoring_findings" ? findingQuery : provenanceQuery) },
      user: { id: "10000000-0000-4000-8000-000000000001" }, organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role: "owner" },
    };
    hoisted.createServiceClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: false, error: null }) });
    const form = new FormData();
    form.set("id", "40000000-0000-4000-8000-000000000001");
    form.set("status", "acknowledged");

    await expect(transitionGitHubFindingAction(form)).resolves.toEqual({
      ok: true,
      message: "GitHub finding is already Acknowledged.",
    });
  });
});
