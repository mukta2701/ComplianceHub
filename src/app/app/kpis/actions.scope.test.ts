import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "90000000-0000-4000-8000-000000000001";
const USER_ID = "90000000-0000-4000-8000-000000000003";
const KPI_ID = "90000000-0000-4000-8000-000000000004";
const TASK_ID = "90000000-0000-4000-8000-000000000005";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function kpiLookup(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return builder;
}

function context(kpi: unknown, rpc = hoisted.rpc) {
  const lookup = kpiLookup(kpi);
  const from = vi.fn((table: string) => {
    if (table === "kpis") return lookup;
    throw new Error(`Unexpected table ${table}`);
  });
  hoisted.ctx = {
    supabase: { from, rpc },
    user: { id: USER_ID },
    organisation: { id: ORG_ID },
  };
  return { from, lookup };
}

describe("raiseKpiTaskAction active-workspace scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.enforceRateLimit.mockResolvedValue(undefined);
    hoisted.rpc.mockResolvedValue({ data: TASK_ID, error: null });
  });

  it("rejects a sibling-workspace KPI before calling the atomic RPC", async () => {
    const { from, lookup } = context(null);

    const { raiseKpiTaskAction } = await import("./actions");
    await expect(raiseKpiTaskAction(form({ id: KPI_ID, indicator: "Spoofed", nextSteps: "Spoofed" })))
      .rejects.toThrow("KPI not found in active workspace");
    expect(from).toHaveBeenCalledWith("kpis");
    expect(lookup.eq).toHaveBeenCalledWith("id", KPI_ID);
    expect(lookup.eq).toHaveBeenCalledWith("organisation_id", ORG_ID);
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed KPI id before querying or mutating", async () => {
    const from = vi.fn();
    hoisted.ctx = { supabase: { from, rpc: hoisted.rpc }, user: { id: USER_ID }, organisation: { id: ORG_ID } };

    const { raiseKpiTaskAction } = await import("./actions");
    await expect(raiseKpiTaskAction(form({ id: "not-a-uuid", indicator: "Access reviews", nextSteps: "Review access" })))
      .rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it("uses the active organisation and owner only with the atomic RPC", async () => {
    context({ id: KPI_ID, organisation_id: ORG_ID, indicator: "Scoped indicator", next_steps: "Scoped next steps", task_id: null });

    const { raiseKpiTaskAction } = await import("./actions");
    await expect(raiseKpiTaskAction(form({ id: KPI_ID, indicator: "Spoofed", nextSteps: "Spoofed", ownerId: USER_ID }))).resolves.toBeUndefined();
    expect(hoisted.rpc).toHaveBeenCalledWith("raise_kpi_task", {
      target_organisation_id: ORG_ID,
      target_kpi_id: KPI_ID,
      target_owner_id: USER_ID,
    });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/kpis");
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/tasks");
  });

  it("rejects an already-linked KPI without calling the RPC", async () => {
    context({ id: KPI_ID, organisation_id: ORG_ID, indicator: "Access reviews", next_steps: "Review access", task_id: TASK_ID });

    const { raiseKpiTaskAction } = await import("./actions");
    await expect(raiseKpiTaskAction(form({ id: KPI_ID, indicator: "Access reviews", nextSteps: "Review access" })))
      .rejects.toThrow("This KPI already has a follow-up task");
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it("maps a concurrent duplicate claim to the stable duplicate error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });
    context({ id: KPI_ID, organisation_id: ORG_ID, indicator: "Access reviews", next_steps: "Review access", task_id: null }, rpc);

    const { raiseKpiTaskAction } = await import("./actions");
    await expect(raiseKpiTaskAction(form({ id: KPI_ID, indicator: "Access reviews", nextSteps: "Review access" })))
      .rejects.toThrow("This KPI already has a follow-up task");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("maps other RPC failures without exposing database details", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "private database detail" } });
    context({ id: KPI_ID, organisation_id: ORG_ID, indicator: "Access reviews", next_steps: "Review access", task_id: null }, rpc);

    const { raiseKpiTaskAction } = await import("./actions");
    await expect(raiseKpiTaskAction(form({ id: KPI_ID, indicator: "Access reviews", nextSteps: "Review access" })))
      .rejects.toThrow("Could not raise the KPI follow-up task");
  });
});
