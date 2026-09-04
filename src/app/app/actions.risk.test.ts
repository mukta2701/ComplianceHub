import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "owner", row: {} as Record<string, unknown>, writes: 0 }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  membership: { role: state.role }, organisation: { id: "11111111-1111-4111-8111-111111111111" }, user: { id: "owner" },
  supabase: { from: () => {
    let patch: Record<string, unknown> | undefined;
    let removing = false;
    const filters: [string, unknown][] = [];
    const result = () => {
      const matched = filters.every(([key, value]) => state.row[key] === value);
      if (matched && (patch || removing)) { state.writes++; Object.assign(state.row, patch ?? { deleted: true }); }
      return { data: matched ? { ...state.row } : null, error: null };
    };
    const q = { insert: async (value: Record<string, unknown>) => { state.row = value; state.writes++; return { error: null }; },
      update: (value: Record<string, unknown>) => { patch = value; return q; }, delete: () => { removing = true; return q; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, select: () => q,
      maybeSingle: async () => result(), then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    }; return q;
  } },
}) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { createRiskAction, deleteRiskAction, updateRiskStatusAction } from "./actions";
const form = (values: Record<string, string>) => { const data = new FormData(); Object.entries(values).forEach(([k, v]) => data.set(k, v)); return data; };
beforeEach(() => { state.role = "owner"; state.writes = 0; state.row = { id: "risk-1", organisation_id: "11111111-1111-4111-8111-111111111111", status: "open" }; });
describe("risk mutation results", () => {
  it("accepts the form's unassigned owner option", async () => {
    await createRiskAction(form({ reference: "R-001", title: "Endpoint risk", description: "Unencrypted endpoints", categoryId: "22222222-2222-4222-8222-222222222222", ownerId: "", likelihood: "3", impact: "4", residualLikelihood: "2", residualImpact: "2", treatment: "mitigate", status: "open" }));
    expect(state.row.owner_id).toBeNull();
  });
  it.each([deleteRiskAction, updateRiskStatusAction])("rejects a Member before mutation", async (action) => {
    state.role = "member";
    await expect(action(form({ id: "risk-1", status: "closed" }))).rejects.toThrow();
    expect(state.writes).toBe(0);
  });
  it.each([deleteRiskAction, updateRiskStatusAction])("reports a stale or out-of-workspace id", async (action) => {
    await expect(action(form({ id: "missing", status: "closed" }))).rejects.toThrow();
    expect(state.writes).toBe(0);
  });
  it("updates an operator's active-workspace risk", async () => {
    await updateRiskStatusAction(form({ id: "risk-1", status: "closed" }));
    expect(state.row.status).toBe("closed");
  });
});
