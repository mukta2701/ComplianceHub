import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("./actions", () => ({ createTaskFormAction: actions.create, updateTaskFormAction: actions.update }));

import { TaskForm, type TaskFormValues } from "./task-form";

const initial: TaskFormValues = {
  title: "Access review", detail: "Review privileged access", ownerId: "", dueOn: "",
  recurrence: "", controlId: "", riskId: "",
};
const options = { members: [], controls: [], risks: [] };

describe("TaskForm", () => {
  beforeEach(() => { actions.create.mockReset(); actions.update.mockReset(); });

  it("keeps the draft and its original edit version together across a server prop refresh", async () => {
    const user = userEvent.setup();
    const view = render(<TaskForm mode="edit" taskId="task-1" expectedUpdatedAt="2026-09-10T01:00:00Z" values={initial} options={options} cancelHref="/app/tasks/task-1" />);
    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Local unsaved title");

    view.rerender(<TaskForm mode="edit" taskId="task-1" expectedUpdatedAt="2026-09-10T02:00:00Z" values={{ ...initial, title: "New server title" }} options={options} cancelHref="/app/tasks/task-1" />);

    expect(title).toHaveValue("Local unsaved title");
    expect(view.container.querySelector('input[name="expectedUpdatedAt"]')).toHaveValue("2026-09-10T01:00:00Z");
  });

  it("associates returned field errors with detail and due date", async () => {
    actions.create.mockResolvedValue({
      error: "Check the highlighted fields and try again.",
      fieldErrors: { detail: ["Detail is too long"], dueOn: ["Use a valid date"] },
    });
    const user = userEvent.setup();
    render(<TaskForm mode="create" values={initial} options={options} cancelHref="/app/tasks" />);
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(await screen.findByText("Detail is too long")).toHaveAttribute("id", "task-detail-error");
    expect(screen.getByText("Use a valid date")).toHaveAttribute("id", "task-due-on-error");
    expect(screen.getByRole("textbox", { name: "Detail" })).toHaveAttribute("aria-describedby", expect.stringContaining("task-detail-error"));
    expect(screen.getByLabelText("Due date")).toHaveAttribute("aria-describedby", "task-due-on-error");
  });
});
