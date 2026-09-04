import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "is", "maybeSingle"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "tasks" ? { id: "task-1", title: "Rotate keys", detail: null, status: "open", due_on: null, recurrence: null, source: "manual", owner_id: null, control_id: null, risk_id: "risk-1", created_at: "", updated_at: "" } : table === "ai_workspace_settings" ? { enabled: true } : table === "risks" ? { id: "risk-1", reference: "R-1", title: "Key exposure" } : table === "evidence_links" ? [] : null, error: null }).then(resolve);
  return chain;
}
vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve({ organisation: { id: "org-1" }, membership: { role: "member" }, supabase: { from: (table: string) => query(table) } }) }));
vi.mock("../actions", () => ({ updateTaskStatusAction: vi.fn() }));
vi.mock("./tracker-actions", () => ({ pushTaskToTrackerAction: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
import TaskDetailPage from "./page";

describe("TaskDetailPage restored AI panel", () => {
  it("loads the workspace setting and shows draft only assistance to Members", async () => {
    render(await TaskDetailPage({ params: Promise.resolve({ id: "task-1" }) }));
    expect(screen.getByLabelText("AI Explain and Act")).toBeInTheDocument();
    expect(screen.getByText(/draft only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /draft explanation/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit task" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /R-1: Key exposure/ })).toHaveAttribute("href", "/app/risks/risk-1");
  });
});
