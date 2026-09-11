import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ raiseFindingAction:vi.fn() }));
import { AuditFindingForm } from "./audit-finding-form";

it("requires corrective action when the operator asks for a corrective-action task", async () => {
  const user = userEvent.setup();
  render(<AuditFindingForm auditId="audit-1" members={[]} />);
  const correctiveAction = screen.getByLabelText(/^Corrective action/);
  expect(correctiveAction).not.toBeRequired();
  await user.click(screen.getByRole("checkbox", { name:/Raise a corrective-action task/ }));
  expect(correctiveAction).toBeRequired();
  expect(screen.getByText(/required for a task/i)).toBeInTheDocument();
});

it("lets the operator associate a formal finding with a checklist item", () => {
  render(<AuditFindingForm auditId="audit-1" members={[]} checklistItems={[{ id:"item-1",label:"A.5 — Review access" }]} />);

  const checklist = screen.getByRole("combobox", { name:"Checklist item" });
  expect(checklist).toHaveValue("");
  expect(screen.getByRole("option", { name:"A.5 — Review access" })).toHaveValue("item-1");
});
