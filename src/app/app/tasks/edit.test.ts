import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ ctx: null as unknown, redirect: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("next/navigation", () => ({ redirect: hoisted.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));

function form(values: Record<string, string>) { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; }
function query(result: { data: unknown; error: unknown; count?: number | null }) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ["select", "eq", "update"]) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn().mockResolvedValue(result);
  q.single = vi.fn().mockResolvedValue(result);
  return q;
}

describe("updateTaskAction", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("rejects Members before reading or writing a task", async () => {
    const from = vi.fn();
    hoisted.ctx = { supabase: { from }, organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role: "member" } };
    const { updateTaskAction } = await import("./actions");
    await expect(updateTaskAction(form({ id: "30000000-0000-4000-8000-000000000001", title: "Updated" }))).rejects.toThrow("Only workspace operators can edit tasks");
    expect(from).not.toHaveBeenCalled();
  });

  it("updates only metadata within the active organisation and preserves task state", async () => {
    const task = { id: "30000000-0000-4000-8000-000000000001", status: "in_progress", source: "gap" };
    const taskQuery = query({ data: task, error: null });
    const updateQuery = query({ data: { id: task.id }, error: null });
    updateQuery.update.mockReturnValue(updateQuery);
    const from = vi.fn((table: string) => { if (table === "tasks") return taskQuery; throw new Error(`unexpected ${table}`); });
    taskQuery.update.mockReturnValue(updateQuery);
    hoisted.ctx = { supabase: { from }, user: { id: "10000000-0000-4000-8000-000000000002" }, organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role: "admin" } };
    const { updateTaskAction } = await import("./actions");
    await updateTaskAction(form({ id: task.id, title: "Updated", detail: "New detail", ownerId: "10000000-0000-4000-8000-000000000001", dueOn: "2026-10-01", recurrence: "monthly", controlId: "40000000-0000-4000-8000-000000000001", riskId: "50000000-0000-4000-8000-000000000001" }));
    expect(taskQuery.update).toHaveBeenCalledWith({ title: "Updated", detail: "New detail", owner_id: "10000000-0000-4000-8000-000000000001", due_on: "2026-10-01", recurrence: "monthly", control_id: "40000000-0000-4000-8000-000000000001", risk_id: "50000000-0000-4000-8000-000000000001", updated_at: expect.any(String) });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/tasks");
  });

  it("reports a missing or sibling task when the scoped update affects no row", async () => {
    const taskQuery = query({ data: null, error: null });
    const from = vi.fn(() => taskQuery);
    hoisted.ctx = { supabase: { from }, user: { id: "10000000-0000-4000-8000-000000000002" }, organisation: { id: "20000000-0000-4000-8000-000000000001" }, membership: { role: "owner" } };
    const { updateTaskAction } = await import("./actions");
    await expect(updateTaskAction(form({ id: "30000000-0000-4000-8000-000000000001", title: "Updated" }))).rejects.toThrow("Task not found");
  });
});
