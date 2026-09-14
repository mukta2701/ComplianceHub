import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect, notFound: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve({ membership: { role: "member" }, organisation: { id: "org-1" }, supabase: { from } }) }));
vi.mock("../../actions", () => ({ updateTaskAction: vi.fn() }));

import EditTaskPage from "./page";

describe("EditTaskPage member branch", () => {
  it("redirects Members before loading the edit form", async () => {
    redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
    await expect(EditTaskPage({ params: Promise.resolve({ id: "task-1" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/app/tasks/task-1");
    expect(from).not.toHaveBeenCalled();
  });
});
