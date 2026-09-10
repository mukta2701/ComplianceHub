import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./actions", () => ({ updatePolicyAction: mocks.save }));
vi.mock("./policy-edit-actions", () => ({ savePolicyEditAction: mocks.save }));
import { PolicyEditForm } from "./policy-edit-form";
const policy = { id: "policy-1", reference: "POL-1", title: "Security policy", body: "Original content", ownerId: "alex", reviewDue: "2026-10-01", version: 3, revision: 7 };
const owners = [{ id: "alex", name: "Alex" }, { id: "blair", name: "Blair" }];
beforeEach(() => { vi.clearAllMocks(); });
it("prevents repeated saves while pending and announces success only after the save finishes", async () => {
  let finish!: (result: { success: string }) => void;
  mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<PolicyEditForm policy={policy} owners={owners} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "Policy owner" }), "blair");
  expect(screen.getByRole("combobox", { name: "Policy owner" })).toHaveValue("blair");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.queryByText("Policy changes saved.")).not.toBeInTheDocument();
  await act(async () => { finish({ success: "Policy changes saved." }); });
  expect(await screen.findByRole("status")).toHaveTextContent("Policy changes saved.");
  expect(screen.getByRole("combobox", { name: "Policy owner" })).toHaveValue("blair");
});
it("preserves every entered field after rejection and clears a stale saved message when edited again", async () => {
  mocks.save.mockResolvedValueOnce({ error: "The policy changed. Copy your entries before refreshing." }).mockResolvedValueOnce({ success: "Policy changes saved." });
  render(<PolicyEditForm policy={policy} owners={owners} />);
  const user = userEvent.setup();
  await user.clear(screen.getByRole("textbox", { name: "Title" }));
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Updated security policy");
  await user.selectOptions(screen.getByRole("combobox", { name: "Policy owner" }), "blair");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Copy your entries");
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Updated security policy");
  expect(screen.getByRole("combobox", { name: "Policy owner" })).toHaveValue("blair");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Policy changes saved.");
  await user.type(screen.getByRole("textbox", { name: "Title" }), " draft");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("keeps edits and explains when the save response is interrupted", async () => {
  mocks.save.mockRejectedValueOnce(new Error("network disconnected"));
  render(<PolicyEditForm policy={policy} owners={owners} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "Policy owner" }), "blair");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm whether the policy was saved");
  expect(screen.getByRole("combobox", { name: "Policy owner" })).toHaveValue("blair");
});
it("does not silently adopt a newer revision while keeping an older draft", async () => {
  mocks.save.mockResolvedValue({ error: "The policy changed. Review the latest policy." });
  const view = render(<PolicyEditForm policy={policy} owners={owners} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Policy content" }), " Local amendment");
  view.rerender(<PolicyEditForm policy={{ ...policy, body: "Another reviewer changed this", version: 4 }} owners={owners} />);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(mocks.save.mock.calls[0][1].get("expectedVersion")).toBe("3");
  expect(await screen.findByRole("alert")).toHaveTextContent("Review the latest policy");
});
it("uses the revision confirmed by its own save for the next edit", async () => {
  mocks.save.mockResolvedValue({ success: "Policy changes saved.", version: 4 });
  render(<PolicyEditForm policy={policy} owners={owners} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Policy content" }), " First amendment");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("status");
  await user.type(screen.getByRole("textbox", { name: "Policy content" }), " Second amendment");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("status");
  expect(mocks.save.mock.calls[1][1].get("expectedVersion")).toBe("4");
});

it("shows a delayed save failure even when the user keeps typing", async () => {
  let finish!: (result: { error: string }) => void;
  mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<PolicyEditForm policy={policy} owners={owners} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await user.type(screen.getByRole("textbox", { name: "Title" }), " additional draft");
  await act(async () => { finish({ error: "Could not confirm whether the policy was saved." }); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm");
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Security policy additional draft");
});
it("keeps the committed revision after a notification warning so the next edit can save", async () => {
  mocks.save.mockResolvedValueOnce({ error: "Saved, but notification failed.", version: 4 }).mockResolvedValueOnce({ success: "Policy changes saved.", version: 5 });
  render(<PolicyEditForm policy={policy} owners={owners} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  await user.type(screen.getByRole("textbox", { name: "Policy content" }), " Another amendment");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("status");
  expect(mocks.save.mock.calls[1][1].get("expectedVersion")).toBe("4");
});

it("preserves its original edit revision across a remote rerender and advances only after its own save", async () => {
  mocks.save.mockResolvedValue({ success: "Policy changes saved.", version: 3, revision: 8 });
  const view = render(<PolicyEditForm policy={policy} owners={owners} />);
  const user = userEvent.setup();
  view.rerender(<PolicyEditForm policy={{ ...policy, revision: 9 }} owners={owners} />);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("status");
  expect(mocks.save.mock.calls[0][1].get("expectedRevision")).toBe("7");
  await user.type(screen.getByRole("textbox", { name: "Title" }), " amendment");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("status");
  expect(mocks.save.mock.calls[1][1].get("expectedRevision")).toBe("8");
});
