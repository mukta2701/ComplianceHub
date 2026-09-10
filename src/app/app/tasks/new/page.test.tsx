import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ failedTable: "", create: vi.fn() }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  membership: { role: "owner" }, organisation: { id: "org-1" },
  supabase: { from: (table: string) => {
    const rows = table === "memberships"
      ? [{ user_id: "owner-1", profiles: { display_name: "Alex" } }]
      : table === "controls" ? [{ id: "control-1", code: "CH-018", title: "Access reviews" }]
        : [{ id: "risk-1", reference: "RSK-014", title: "Excessive access" }];
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "order"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: table === fixture.failedTable ? { message: "Unavailable" } : null }).then(resolve);
    return query;
  } },
}) }));
vi.mock("../actions", () => ({ createTaskAction: vi.fn(), createTaskFormAction: fixture.create }));

import NewTaskPage from "./page";

describe("new task form", () => {
  beforeEach(() => { fixture.failedTable = ""; fixture.create.mockReset(); });

  it("presents one reviewable task workflow with clear groups and destinations", async () => {
    render(await NewTaskPage());
    expect(screen.getByRole("heading", { name: "Create a task" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Task brief" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Ownership and timing" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Linked records" })).toBeInTheDocument();
    expect(screen.getByText(/next occurrence when completed and a due date is set/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to work queue" })).toHaveAttribute("href", "/app/tasks");
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/app/tasks");
  });

  it.each(["memberships", "controls", "risks"])("fails closed when %s choices are unavailable", async (table) => {
    fixture.failedTable = table;
    await expect(NewTaskPage()).rejects.toThrow("Could not load task choices");
  });

  it("shows an expected save error without clearing entered work", async () => {
    fixture.create.mockResolvedValue({ error: "Could not save task. Try again." });
    const user = userEvent.setup();
    render(await NewTaskPage());
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Quarterly access review");
    await user.type(screen.getByRole("textbox", { name: "Detail" }), "Keep this explanation visible");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save task");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Quarterly access review");
    expect(screen.getByRole("textbox", { name: "Detail" })).toHaveValue("Keep this explanation visible");
  });
});
