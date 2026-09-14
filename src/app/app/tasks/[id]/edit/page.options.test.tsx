import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failedTable: "", membersRead: 0, controlsRead: 0, risksRead: 0 }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  membership: { role: "owner" }, organisation: { id: "org-1" },
  supabase: { from: (table: string) => {
    let data: unknown;
    if (table === "tasks") data = {
      id: "task-1", title: "Review access", detail: "Confirm access remains appropriate", status: "open",
      owner_id: "owner-1", due_on: "2026-10-12", recurrence: "quarterly", control_id: "control-selected",
      risk_id: "risk-selected", updated_at: "2026-09-10T01:00:00.000Z",
    };
    else if (table === "memberships") data = state.membersRead++ === 0
      ? [{ user_id: "owner-listed", profiles: { display_name: "Blair" } }]
      : { user_id: "owner-1", profiles: { display_name: "Alex" } };
    else if (table === "controls") data = state.controlsRead++ === 0
      ? [{ id: "control-listed", code: "CH-001", title: "Listed control" }]
      : { id: "control-selected", code: "CH-999", title: "Previously linked control" };
    else data = state.risksRead++ === 0
      ? [{ id: "risk-listed", reference: "RSK-001", title: "Listed risk", status: "open" }]
      : { id: "risk-selected", reference: "RSK-999", title: "Previously linked risk", status: "closed" };
    const result = { data, error: table === state.failedTable ? { message: "Unavailable" } : null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "maybeSingle"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  } },
}) }));
vi.mock("../../actions", () => ({ updateTaskAction: vi.fn(), updateTaskFormAction: vi.fn() }));

import EditTaskPage from "./page";

describe("task option loading", () => {
  beforeEach(() => { state.failedTable = ""; state.membersRead = 0; state.controlsRead = 0; state.risksRead = 0; });

  it.each(["memberships", "controls", "risks"])("does not render a form that clears links when %s fails", async (table) => {
    state.failedTable = table;
    await expect(EditTaskPage({ params: Promise.resolve({ id: "task-1" }) })).rejects.toThrow("Could not load task choices");
  });

  it("keeps previously linked records available when they are absent from the main choice page", async () => {
    const { container } = render(await EditTaskPage({ params: Promise.resolve({ id: "task-1" }) }));
    expect(screen.getByRole("option", { name: "CH-999: Previously linked control" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "RSK-999: Previously linked risk" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Linked control" })).toHaveValue("control-selected");
    expect(screen.getByRole("combobox", { name: "Linked risk" })).toHaveValue("risk-selected");
    expect(screen.getByRole("option", { name: "Alex" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue("owner-1");
    expect(container.querySelector('input[name="expectedUpdatedAt"]')).toHaveValue("2026-09-10T01:00:00.000Z");
  });
});
