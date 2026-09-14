import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  ctx: null as unknown,
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(fixture.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: fixture.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidatePath }));

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

function mutation(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["insert", "update", "eq", "select"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve));
  return query;
}

describe("recoverable task form actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.ctx = {
      supabase: { from: vi.fn(() => mutation({ data: { id: "task-1" }, error: null })) },
      user: { id: "10000000-0000-4000-8000-000000000001" },
      organisation: { id: "20000000-0000-4000-8000-000000000001" },
      membership: { role: "owner" },
    };
  });

  it("provide a state-returning create action for the interactive form", async () => {
    const actions = await import("./actions");
    expect(typeof actions.createTaskFormAction).toBe("function");
  });

  it("provide a state-returning update action for the interactive form", async () => {
    const actions = await import("./actions");
    expect(typeof actions.updateTaskFormAction).toBe("function");
  });

  it("returns a field error instead of throwing away an invalid title", async () => {
    const { createTaskFormAction } = await import("./actions");
    const result = await createTaskFormAction({}, form({ title: "   ", detail: "Keep this detail" }));
    expect(result.error).toBe("Check the highlighted fields and try again.");
    expect(result.fieldErrors?.title).toBeTruthy();
  });

  it("returns a retryable message when a create write fails", async () => {
    fixture.ctx = {
      ...(fixture.ctx as object),
      supabase: { from: vi.fn(() => mutation({ data: null, error: { message: "write failed" } })) },
    };
    const { createTaskFormAction } = await import("./actions");
    const result = await createTaskFormAction({}, form({ title: "Quarterly access review" }));
    expect(result).toEqual({ error: "Could not save task. Try again." });
  });

  it("rejects a Member before attempting to create a task", async () => {
    const from = vi.fn();
    fixture.ctx = { ...(fixture.ctx as object), membership: { role: "member" }, supabase: { from } };
    const { createTaskFormAction } = await import("./actions");
    await expect(createTaskFormAction({}, form({ title: "Attempted task" }))).rejects.toThrow("Only workspace operators can create tasks");
    expect(from).not.toHaveBeenCalled();
  });

  it("returns a conflict without redirecting when the expected edit version is stale", async () => {
    fixture.ctx = {
      ...(fixture.ctx as object),
      supabase: { from: vi.fn(() => mutation({ data: null, error: null })) },
    };
    const { updateTaskFormAction } = await import("./actions");
    const result = await updateTaskFormAction({}, form({
      id: "30000000-0000-4000-8000-000000000001",
      expectedUpdatedAt: "2026-09-10T00:00:00.000Z",
      title: "Updated access review",
    }));
    expect(result).toEqual({ error: "This task changed or is no longer available. Reload it before saving again.", conflict: true });
    expect(fixture.redirect).not.toHaveBeenCalled();
  });
});
