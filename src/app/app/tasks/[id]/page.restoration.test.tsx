import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ taskError: false, tickets: [] as Array<Record<string, unknown>> }));
function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "is", "maybeSingle"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "tasks" ? { id: "task-1", title: "Rotate keys", detail: null, status: "open", due_on: null, recurrence: null, source: "manual", assignment_revision: 0, owner_id: null, control_id: null, risk_id: "risk-1", created_at: "", updated_at: "" } : table === "ai_workspace_settings" ? { enabled: true } : table === "risks" ? { id: "risk-1", reference: "R-1", title: "Key exposure" } : table === "evidence_links" ? [] : table === "task_tickets" ? state.tickets : null, error: table === "tasks" && state.taskError ? { message: "private detail" } : null }).then(resolve);
  return chain;
}
vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve({ organisation: { id: "org-1" }, user: { id: "user-1" }, membership: { role: "member" }, supabase: { from: (table: string) => query(table) } }) }));
vi.mock("../actions", () => ({ updateTaskStatusAction: vi.fn() }));
vi.mock("./tracker-actions", () => ({ pushTaskToTrackerAction: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
import TaskDetailPage from "./page";

describe("TaskDetailPage restored AI panel", () => {
  it("loads the workspace setting and shows draft only assistance to Members", async () => {
    state.taskError = false;
    state.tickets = [];
    render(await TaskDetailPage({ params: Promise.resolve({ id: "task-1" }) }));
    expect(screen.getByRole("region", { name: "Task overview" })).toHaveTextContent("Open");
    expect(screen.getByLabelText("AI Explain and Act")).toBeInTheDocument();
    expect(screen.getByText(/draft only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /draft explanation/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit task" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /R-1: Key exposure/ })).toHaveAttribute("href", "/app/risks/risk-1");
  });
  it("fails closed when the requested task cannot be read", async () => {
    state.taskError = true;
    await expect(TaskDetailPage({ params: Promise.resolve({ id: "task-1" }) })).rejects.toThrow("Could not load task");
  });
  it("shows every tracker linked to the task", async () => {
    state.taskError = false;
    state.tickets = [
      { external_id: "GRC-21", external_url: "https://tracker.example/GRC-21", external_status: "open", last_synced_at: "2026-09-09T10:00:00Z" },
      { external_id: "SEC-8", external_url: "https://tracker.example/SEC-8", external_status: "done", last_synced_at: "2026-09-09T11:00:00Z" },
    ];
    render(await TaskDetailPage({ params: Promise.resolve({ id: "task-1" }) }));
    expect(screen.getByRole("link", { name: /GRC-21/ })).toHaveAttribute("href", "https://tracker.example/GRC-21");
    expect(screen.getByRole("link", { name: /SEC-8/ })).toHaveAttribute("href", "https://tracker.example/SEC-8");
  });
});
