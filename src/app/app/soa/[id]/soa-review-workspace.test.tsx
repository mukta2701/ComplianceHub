import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SoaQueueItem } from "@/features/soa/application/review-queue";
import { SoaReviewWorkspace } from "./soa-review-workspace";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

const CURRENT_USER_ID = "member-1";

const items: SoaQueueItem[] = [
  {
    id: "item-1",
    controlId: "control-1",
    code: "A.5.1",
    title: "Policies for information security",
    domain: "organisational",
    applicable: true,
    status: "pending",
    justification: "",
    evidenceText: "",
    ownerId: null,
    ownerName: null,
    evidenceTotal: 0,
    evidenceExpiring: 0,
    evidenceExpired: 0,
    openTaskCount: 0,
    position: 1,
    reviewState: "missing_decision",
  },
  {
    id: "item-2",
    controlId: "control-2",
    code: "A.6.3",
    title: "Information security awareness",
    domain: "people",
    applicable: true,
    status: "in_progress",
    justification: "Training is scheduled for all staff.",
    evidenceText: "Annual learning plan",
    ownerId: CURRENT_USER_ID,
    ownerName: "Maya Chen",
    evidenceTotal: 1,
    evidenceExpiring: 0,
    evidenceExpired: 0,
    openTaskCount: 1,
    position: 2,
    reviewState: "reviewed",
  },
  {
    id: "item-3",
    controlId: "control-3",
    code: "A.8.8",
    title: "Management of technical vulnerabilities",
    domain: "technological",
    applicable: true,
    status: "operational",
    justification: "",
    evidenceText: "Scanner report",
    ownerId: "member-2",
    ownerName: "Alex Morgan",
    evidenceTotal: 1,
    evidenceExpiring: 0,
    evidenceExpired: 1,
    openTaskCount: 2,
    position: 3,
    reviewState: "missing_rationale",
  },
  {
    id: "item-4",
    controlId: "control-4",
    code: "A.7.1",
    title: "Physical security perimeters",
    domain: "physical",
    applicable: true,
    status: "established",
    justification: "Secure site boundaries protect restricted areas.",
    evidenceText: "Site access procedure",
    ownerId: CURRENT_USER_ID,
    ownerName: "Maya Chen",
    evidenceTotal: 0,
    evidenceExpiring: 0,
    evidenceExpired: 0,
    openTaskCount: 0,
    position: 4,
    reviewState: "missing_evidence",
  },
];

const members = [
  { id: CURRENT_USER_ID, name: "Maya Chen" },
  { id: "member-2", name: "Alex Morgan" },
];

function renderWorkspace(saveAction = vi.fn<(formData: FormData) => Promise<void>>(async () => undefined)) {
  return render(
    <SoaReviewWorkspace
      items={items}
      members={members}
      currentUserId={CURRENT_USER_ID}
      saveAction={saveAction}
    />,
  );
}

function queue() {
  return within(screen.getByRole("region", { name: "SoA review queue" }));
}

describe("SoaReviewWorkspace", () => {
  beforeEach(() => {
    navigation.refresh.mockReset();
  });

  it("opens in needs-attention view with one editable review form", () => {
    const { container } = renderWorkspace();

    expect(screen.getByRole("button", { name: "Needs attention 3" })).toHaveAttribute("aria-pressed", "true");
    expect(queue().getByText("Policies for information security")).toBeInTheDocument();
    expect(queue().getByText("Management of technical vulnerabilities")).toBeInTheDocument();
    expect(queue().queryByText("Information security awareness")).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Rationale" })).toHaveLength(1);
    expect(container.querySelectorAll("form")).toHaveLength(1);
  });

  it("filters from summary blockers and narrows results by search", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Missing rationale 2" }));
    expect(queue().getByText("Policies for information security")).toBeInTheDocument();
    expect(queue().getByText("Management of technical vulnerabilities")).toBeInTheDocument();
    expect(queue().queryByText("Physical security perimeters")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search controls" }), "vulnerabilities");
    expect(queue().queryByText("Policies for information security")).not.toBeInTheDocument();
    expect(queue().getByText("Management of technical vulnerabilities")).toBeInTheDocument();
  });

  it("supports toolbar filters and only shows clear filters while any filter is active", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear).toBeInTheDocument();
    await user.click(clear);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    expect(queue().getByText("Information security awareness")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Domain" }), "people");
    expect(queue().getByText("Information security awareness")).toBeInTheDocument();
    expect(queue().queryByText("Policies for information security")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Review state" }), "reviewed");
    await user.selectOptions(screen.getByRole("combobox", { name: "Owner" }), CURRENT_USER_ID);
    await user.selectOptions(screen.getByRole("combobox", { name: "Applicability" }), "true");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("changes the editable detail when a queue row is selected", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(queue().getByRole("button", { name: "Review A.7.1 Physical security perimeters" }));

    expect(screen.getByRole("heading", { name: "A.7.1 Physical security perimeters" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Rationale" })).toHaveValue(
      "Secure site boundaries protect restricted areas.",
    );
  });

  it("limits the queue to controls owned by the current user", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("checkbox", { name: "Only my controls" }));

    expect(queue().getByText("Physical security perimeters")).toBeInTheDocument();
    expect(queue().queryByText("Policies for information security")).not.toBeInTheDocument();
    expect(queue().queryByText("Management of technical vulnerabilities")).not.toBeInTheDocument();
  });

  it("couples not-applicable decisions to the status field", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const applicability = screen.getByRole("combobox", { name: "Applicability decision" });
    const status = screen.getByRole("combobox", { name: "Implementation status" });

    await user.selectOptions(applicability, "false");
    expect(status).toHaveValue("not_applicable");

    await user.selectOptions(applicability, "true");
    expect(status).toHaveValue("pending");
  });

  it("saves once and advances to the next unresolved visible control", async () => {
    const user = userEvent.setup();
    const saveAction = vi.fn<(formData: FormData) => Promise<void>>(async () => undefined);
    renderWorkspace(saveAction);

    await user.selectOptions(screen.getByRole("combobox", { name: "Implementation status" }), "in_progress");
    await user.selectOptions(screen.getByRole("combobox", { name: "Owner assignment" }), CURRENT_USER_ID);
    await user.type(screen.getByRole("textbox", { name: "Rationale" }), "Policy ownership has been agreed.");
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));
    const formData = saveAction.mock.calls[0][0];
    expect(Object.fromEntries(formData)).toMatchObject({
      itemId: "item-1",
      applicable: "true",
      status: "in_progress",
      ownerId: CURRENT_USER_ID,
      justification: "Policy ownership has been agreed.",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("heading", { name: "A.8.8 Management of technical vulnerabilities" })).toBeInTheDocument();
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("reports save errors and keeps the selected control open", async () => {
    const user = userEvent.setup();
    const saveAction = vi.fn<(formData: FormData) => Promise<void>>(async () => {
      throw new Error("save failed");
    });
    renderWorkspace(saveAction);

    await user.type(screen.getByRole("textbox", { name: "Rationale" }), "A documented reason.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Error: save failed"));
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "A.5.1 Policies for information security" })).toBeInTheDocument();
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("provides labelled controls, a live save region, and honest tab content", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(screen.getByRole("searchbox", { name: "Search controls" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Domain" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Review state" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Owner" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Applicability" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Why this matters")).toBeInTheDocument();
    expect(screen.getByText("What you decide here")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByRole("textbox", { name: "Evidence references" })).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getByText("No linked evidence")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Linked work" }));
    expect(screen.getByText("No linked open work")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("link", { name: "View audit trail" })).toHaveAttribute("href", "/app/activity");
  });

  it("uses mobile-friendly list markup without a table or min-width dependency", () => {
    const { container } = renderWorkspace();

    expect(container.querySelector("ol")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(container.querySelector(".data-table-wrap")).not.toBeInTheDocument();
    expect(container.querySelector('[style*="min-width"]')).not.toBeInTheDocument();
  });
});
