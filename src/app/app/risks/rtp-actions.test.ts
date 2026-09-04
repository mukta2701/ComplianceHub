import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner", row: {} as Record<string, unknown>, writes: 0,
}));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  membership: { role: state.role }, organisation: { id: "org-1" }, user: { id: "owner-1" },
  supabase: { from: () => {
    let patch: Record<string, unknown> | undefined;
    let remove = false;
    const filters: [string, unknown][] = [];
    const result = () => {
      const matches = filters.every(([key, value]) => state.row[key] === value);
      if (matches && (patch || remove)) { state.writes++; Object.assign(state.row, patch ?? { deleted: true }); }
      return { data: matches ? { ...state.row } : null, error: null };
    };
    const query = {
      select: () => query, update: (value: Record<string, unknown>) => { patch = value; return query; },
      delete: () => { remove = true; return query; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } },
}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
import { deleteRtpAction, updateRtpStatusAction } from "./rtp-actions";

function form(status: string, riskId = "risk-1") {
  const data = new FormData();
  Object.entries({ id: "plan-1", riskId, status }).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  state.role = "owner"; state.writes = 0;
  state.row = { id: "plan-1", risk_id: "risk-1", organisation_id: "org-1", status: "completed", actual_completion: "2026-08-01" };
});
describe("treatment lifecycle", () => {
  it.each(["planned", "in_progress", "cancelled"])("clears completion when changing to %s", async (status) => {
    await updateRtpStatusAction(form(status));
    expect(state.row).toMatchObject({ status, actual_completion: null });
  });
  it("preserves the completion date when completion is submitted again", async () => {
    await updateRtpStatusAction(form("completed"));
    expect(state.row.actual_completion).toBe("2026-08-01");
  });
  it("does not update a plan submitted under a different risk", async () => {
    await expect(updateRtpStatusAction(form("planned", "risk-2"))).rejects.toThrow();
    expect(state.writes).toBe(0);
  });
  it("does not delete a plan submitted under a different risk", async () => {
    await expect(deleteRtpAction(form("planned", "risk-2"))).rejects.toThrow();
    expect(state.writes).toBe(0);
  });
  it.each([updateRtpStatusAction, deleteRtpAction])("rejects Member mutations", async (action) => {
    state.role = "member";
    await expect(action(form("planned"))).rejects.toThrow();
    expect(state.writes).toBe(0);
  });
  it("reports a missing plan instead of returning success", async () => {
    state.row.id = "other-plan";
    await expect(updateRtpStatusAction(form("planned"))).rejects.toThrow();
  });
});
