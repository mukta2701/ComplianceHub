import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

type Result = { data: unknown; error: unknown };

class TaskBuilder implements PromiseLike<Result> {
  private operation: "select" | "update" | "insert" = "select";

  constructor(
    private readonly task: Record<string, unknown>,
    private readonly directWrites: string[],
  ) {}

  select() { return this; }
  eq() { return this; }
  single() { return this; }
  maybeSingle() { return this; }

  update() {
    this.operation = "update";
    this.directWrites.push("update");
    return this;
  }

  insert() {
    this.operation = "insert";
    this.directWrites.push("insert");
    return this;
  }

  private result(): Result {
    return this.operation === "select"
      ? { data: this.task, error: null }
      : { data: this.task, error: null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

describe("updateTaskStatusAction", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("rejects Members before reading a task", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from },
      organisation: { id: "20000000-0000-4000-8000-000000000001" },
      membership: { role: "member" },
    };
    const { updateTaskStatusAction } = await import("./actions");
    const formData = new FormData();
    formData.set("id", "30000000-0000-4000-8000-000000000001");
    formData.set("status", "done");

    await expect(updateTaskStatusAction(formData)).rejects.toThrow("Only workspace operators can update task status");
    expect(from).not.toHaveBeenCalled();
  });

  it("completes a recurring task through one atomic RPC", async () => {
    const directWrites: string[] = [];
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const task = {
      id: "30000000-0000-4000-8000-000000000001",
      organisation_id: "20000000-0000-4000-8000-000000000001",
      title: "Quarterly access review",
      detail: "Review access rights",
      owner_id: "10000000-0000-4000-8000-000000000001",
      due_on: "2026-07-31",
      recurrence: "monthly",
      source: "manual",
      control_id: null,
      risk_id: null,
      status: "open",
    };
    const supabase = {
      from: () => new TaskBuilder(task, directWrites),
      rpc,
    };
    hoisted.ctx = {
      supabase,
      user: { id: "10000000-0000-4000-8000-000000000001" },
      organisation: { id: "20000000-0000-4000-8000-000000000001" },
      membership: { role: "admin" },
    };

    const { updateTaskStatusAction } = await import("./actions");
    const formData = new FormData();
    formData.set("id", String(task.id));
    formData.set("status", "done");

    await updateTaskStatusAction(formData);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("complete_recurring_task", {
      target_task_id: task.id,
    });
    expect(directWrites).toEqual([]);
  });
});
