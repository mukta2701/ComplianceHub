import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
const actionState = vi.hoisted(() => ({ result: {} as { error?: string } }));
vi.mock("./contribution-actions", () => ({ submitTaskContributionAction: async () => actionState.result, reviewTaskContributionAction: async () => actionState.result }));
beforeEach(() => { actionState.result = {}; });
import { TaskContributions } from "./task-contributions";
const base = { taskId: "task", ownerId: "author", userId: "author", role: "member", status: "open", assignmentRevision: 2, requestId: "request", names: { author: "Alex", reviewer: "Mukta" }, contributions: [] };
const pending = { id: "submission", submitter_id: "author", assignment_revision: 2, decision: "pending", note: "Restore took 5 minutes", created_at: "2026-09-09T10:00:00Z", reviewer_id: null, reviewed_at: null, rationale: null, evidence_id: null, reviewRequestId: "review-request" };
describe("task contributions", () => {
  it("offers assigned member a note form with review limitations", () => {
    render(<TaskContributions {...base} />);
    expect(screen.getByRole("region", { name: "Work submission and review" })).toBeInTheDocument();
    const progress = within(screen.getByRole("list", { name: "Task review progress" }));
    expect(progress.getByText("Assigned")).toBeInTheDocument();
    expect(progress.getByText("Ready to submit")).toBeInTheDocument();
    expect(progress.getByText("Not submitted")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Work note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
    expect(screen.getByText(/does not complete the task/)).toBeInTheDocument();
  });
  it("does not claim accountability when no owner is assigned", () => {
    render(<TaskContributions {...base} ownerId={null} />);
    const progress = within(screen.getByRole("list", { name: "Task review progress" }));
    expect(progress.getByText("Unassigned")).toBeInTheDocument();
    expect(progress.queryByText("Owner named")).not.toBeInTheDocument();
  });
  it("retains the entered work note when a stale submission is rejected", async () => {
    actionState.result = { error: "The assignment changed. Reload this task before continuing." };
    render(<TaskContributions {...base} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Work note" }), "My careful work note");
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The assignment changed");
    expect(screen.getByRole("textbox", { name: "Work note" })).toHaveValue("My careful work note");
  });
  it("retains review rationale when the database rejects a stale review", async () => {
    actionState.result = { error: "This submission has already been reviewed." };
    render(<TaskContributions {...base} userId="reviewer" role="admin" contributions={[pending]} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Review note" }), "My review rationale");
    await user.click(screen.getByRole("button", { name: "Accept evidence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already been reviewed");
    expect(screen.getByRole("textbox", { name: "Review note" })).toHaveValue("My review rationale");
  });
  it("shows pending history without another submit form or self review", () => {
    render(<TaskContributions {...base} role="owner" contributions={[pending]} />);
    const progress = within(screen.getByRole("list", { name: "Task review progress" }));
    expect(progress.getByText("Submitted")).toBeInTheDocument();
    expect(progress.getByText("Review pending")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText("Restore took 5 minutes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept evidence" })).not.toBeInTheDocument();
  });
  it.each(["done", "cancelled"])("explains why an assignee's pending note cannot be reviewed on a %s task", (status) => {
    render(<TaskContributions {...base} status={status} contributions={[pending]} />);
    expect(screen.getByText("Task closed — no longer reviewable")).toBeInTheDocument();
    expect(screen.getByText("This task is closed. A workspace coordinator must reopen it before this saved note can be reviewed.")).toBeInTheDocument();
    expect(screen.getByText("Restore took 5 minutes")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for review.")).not.toBeInTheDocument();
    expect(screen.queryByText("Awaiting review")).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Task review progress" })).getByText("Review blocked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept evidence" })).not.toBeInTheDocument();
  });
  it.each(["done", "cancelled"])("tells the coordinator to reopen a %s task before reviewing its pending note", (status) => {
    render(<TaskContributions {...base} userId="reviewer" role="admin" status={status} contributions={[pending]} />);
    expect(screen.getByText("Task closed — no longer reviewable")).toBeInTheDocument();
    expect(screen.getByText("This task is closed. A workspace coordinator must reopen it before this saved note can be reviewed.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Review note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request changes" })).not.toBeInTheDocument();
    expect(screen.queryByText("Awaiting review")).not.toBeInTheDocument();
  });
  it.each(["open", "in_progress"])("keeps active waiting guidance for the assignee on an %s task", (status) => {
    render(<TaskContributions {...base} status={status} contributions={[pending]} />);
    expect(screen.getByText("Waiting for review.")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.queryByText(/must reopen/)).not.toBeInTheDocument();
  });
  it("gives independent coordinator exact-version review controls", () => {
    render(<TaskContributions {...base} userId="reviewer" role="admin" contributions={[pending]} />);
    expect(screen.getByRole("textbox", { name: "Review note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept evidence" })).toBeInTheDocument();
  });
  it("labels obsolete assignments and offers fresh assigned work", () => {
    render(<TaskContributions {...base} contributions={[{ ...pending, assignment_revision: 1 }]} />);
    expect(screen.getByText("Assignment changed — no longer reviewable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
  });
  it("shows members their accepted note without an inaccessible vault link", () => {
    render(<TaskContributions {...base} contributions={[{ ...pending, decision: "accepted", evidence_id: "evidence" }]} />);
    expect(screen.getByText("This accepted note is saved as linked evidence.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open accepted evidence" })).not.toBeInTheDocument();
  });
  it("retains review rationale and links accepted evidence", () => {
    render(<TaskContributions {...base} role="admin" userId="reviewer" contributions={[{ ...pending, decision: "accepted", reviewer_id: "reviewer", reviewed_at: "2026-09-09T11:00:00Z", rationale: "Timing checked", evidence_id: "evidence" }]} />);
    const progress = within(screen.getByRole("list", { name: "Task review progress" }));
    expect(progress.getByText("Submitted")).toBeInTheDocument();
    expect(progress.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getAllByText("Accepted")).toHaveLength(2);
    expect(screen.getByText("Timing checked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open accepted evidence" })).toHaveAttribute("href", "/app/evidence?evidence=evidence#evidence-evidence");
  });
});
