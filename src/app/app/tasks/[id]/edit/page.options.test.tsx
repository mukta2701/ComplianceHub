import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ failedTable: "" }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  membership: { role: "owner" }, organisation: { id: "org-1" },
  supabase: { from: (table: string) => {
    const result = { data: table === "tasks" ? { id: "task-1", title: "Review access", owner_id: "owner-1", control_id: "control-1", risk_id: "risk-1" } : [], error: table === state.failedTable ? { message: "Unavailable" } : null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "maybeSingle"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  } },
}) }));
vi.mock("../../actions", () => ({ updateTaskAction: vi.fn() }));
import EditTaskPage from "./page";
describe("task option loading", () => {
  it.each(["memberships", "controls", "risks"])("does not render a form that clears links when %s fails", async (table) => {
    state.failedTable = table;
    await expect(EditTaskPage({ params: Promise.resolve({ id: "task-1" }) })).rejects.toThrow("Could not load task choices");
  });
});
