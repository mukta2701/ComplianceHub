import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./policy-create-actions", () => ({ createPolicyFormAction: mocks.create }));
import { PolicyCreateForm } from "./policy-create-form";
it("keeps the author's draft after an interrupted creation and offers a route back", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Connection interrupted"));
  render(<PolicyCreateForm owners={[]} initial={{ reference: "POL-1", title: "Security policy", body: "Initial statement" }} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Policy content" }), " Added responsibility");
  await user.click(screen.getByRole("button", { name: "Create policy" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm");
  expect(screen.getByRole("textbox", { name: "Policy content" })).toHaveValue("Initial statement Added responsibility");
  expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/app/policies");
});

it("associates a server validation error with its field while keeping the draft", async () => {
  mocks.create.mockResolvedValueOnce({ error: "Check the highlighted fields and try again.", fieldErrors: { title: ["Enter a policy title"] } });
  render(<PolicyCreateForm owners={[]} initial={{ reference: "POL-1", title: "   ", body: "Draft text" }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Create policy" }));
  const title = await screen.findByRole("textbox", { name: "Title" });
  expect(title).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("Enter a policy title")).toHaveAttribute("id", "policy-title-error");
  expect(title).toHaveValue("   ");
});

it("asks before replacing an unfinished draft with a template", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<PolicyCreateForm owners={[]} initial={{ reference: "", title: "", body: "" }} templates={[{ slug: "access", reference: "POL-1", title: "Access policy", summary: "Starter", body: "Starter text" }]} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Policy content" }), "My unfinished policy");
  await user.click(screen.getByRole("button", { name: /Access policy/ }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: "Policy content" })).toHaveValue("My unfinished policy");
  confirm.mockRestore();
});
