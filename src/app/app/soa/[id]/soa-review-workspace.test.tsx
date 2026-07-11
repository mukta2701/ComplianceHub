import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoaReviewWorkspace, type SoaReviewWorkspaceItem } from "./soa-review-workspace";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

const CURRENT_USER_ID = "member-1";

const items: SoaReviewWorkspaceItem[] = [
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
    linkedEvidence: [],
    linkedTasks: [],
    recentAuditEvents: [],
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
    linkedEvidence: [{
      id: "evidence-2",
      title: "Annual learning plan",
      status: "current",
      validUntil: "2027-06-30",
      kind: "note",
    }],
    linkedTasks: [{
      id: "task-2",
      title: "Deliver annual awareness training",
      status: "open",
      dueOn: "2026-09-30",
    }],
    recentAuditEvents: [{ action: "update", occurredAt: "2026-07-10T09:30:00.000Z" }],
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
    linkedEvidence: [{
      id: "evidence-3",
      title: "Quarterly scanner report",
      status: "expired",
      validUntil: "2026-06-30",
      kind: "file",
    }],
    linkedTasks: [
      { id: "task-31", title: "Renew scanner report", status: "open", dueOn: "2026-07-31" },
      { id: "task-32", title: "Patch critical findings", status: "in_progress", dueOn: null },
    ],
    recentAuditEvents: [{ action: "update", occurredAt: "2026-07-09T14:15:00.000Z" }],
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
    linkedEvidence: [],
    linkedTasks: [],
    recentAuditEvents: [],
  },
];

const members = [
  { id: CURRENT_USER_ID, name: "Maya Chen" },
  { id: "member-2", name: "Alex Morgan" },
];

function renderWorkspace(
  saveAction = vi.fn<(formData: FormData) => Promise<void>>(async () => undefined),
  workspaceItems = items,
) {
  return render(
    <SoaReviewWorkspace
      items={workspaceItems}
      members={members}
      currentUserId={CURRENT_USER_ID}
      saveAction={saveAction}
    />,
  );
}

function queue() {
  return within(screen.getByRole("region", { name: "SoA review queue" }));
}

function workspaceItem(overrides: Partial<SoaReviewWorkspaceItem>): SoaReviewWorkspaceItem {
  return {
    ...items[0],
    linkedEvidence: [],
    linkedTasks: [],
    recentAuditEvents: [],
    ...overrides,
  };
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

  it("applies all six summary filters using their displayed counts", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const cases = [
      ["Needs attention 3", ["Policies for information security", "Management of technical vulnerabilities", "Physical security perimeters"]],
      ["Reviewed 1", ["Information security awareness"]],
      ["Missing rationale 2", ["Policies for information security", "Management of technical vulnerabilities"]],
      ["Evidence gaps 3", ["Policies for information security", "Management of technical vulnerabilities", "Physical security perimeters"]],
      ["Unassigned 1", ["Policies for information security"]],
      ["Undecided 1", ["Policies for information security"]],
    ] as const;

    for (const [buttonName, expectedTitles] of cases) {
      await user.click(screen.getByRole("button", { name: buttonName }));
      expect(queue().getAllByRole("listitem")).toHaveLength(expectedTitles.length);
      for (const title of expectedTitles) expect(queue().getByText(title)).toBeInTheDocument();
    }
  });

  it("filters by every implementation status", async () => {
    const user = userEvent.setup();
    const statuses = ["pending", "absent", "in_progress", "established", "operational", "advanced", "not_applicable"] as const;
    const statusItems = statuses.map((status, index) => workspaceItem({
      id: `status-${status}`,
      code: `S${index + 1}`,
      title: `Control with ${status}`,
      status,
      applicable: status !== "not_applicable",
      justification: " ",
      ownerId: CURRENT_USER_ID,
      ownerName: "Maya Chen",
      position: index,
      reviewState: status === "pending" ? "missing_decision" : "missing_rationale",
    }));
    renderWorkspace(undefined, statusItems);

    for (const status of statuses) {
      await user.selectOptions(screen.getByRole("combobox", { name: "Implementation status filter" }), status);
      expect(queue().getAllByRole("listitem")).toHaveLength(1);
      expect(queue().getByText(`Control with ${status}`)).toBeInTheDocument();
    }
  });

  it("filters deterministic no-evidence, current, expiring, and expired states", async () => {
    const user = userEvent.setup();
    const freshnessItems = [
      workspaceItem({ id: "fresh-none", code: "F1", title: "No evidence control", evidenceTotal: 0, evidenceExpiring: 0, evidenceExpired: 0, justification: " ", status: "operational", reviewState: "missing_rationale", position: 1 }),
      workspaceItem({ id: "fresh-current", code: "F2", title: "Current evidence control", evidenceTotal: 1, evidenceExpiring: 0, evidenceExpired: 0, justification: " ", status: "operational", reviewState: "missing_rationale", position: 2 }),
      workspaceItem({ id: "fresh-expiring", code: "F3", title: "Expiring evidence control", evidenceTotal: 1, evidenceExpiring: 1, evidenceExpired: 0, justification: " ", status: "operational", reviewState: "missing_rationale", position: 3 }),
      workspaceItem({ id: "fresh-expired", code: "F4", title: "Expired evidence control", evidenceTotal: 1, evidenceExpiring: 0, evidenceExpired: 1, justification: " ", status: "operational", reviewState: "missing_rationale", position: 4 }),
    ];
    renderWorkspace(undefined, freshnessItems);

    for (const [freshness, title] of [
      ["none", "No evidence control"],
      ["current", "Current evidence control"],
      ["expiring", "Expiring evidence control"],
      ["expired", "Expired evidence control"],
    ] as const) {
      await user.selectOptions(screen.getByRole("combobox", { name: "Evidence freshness" }), freshness);
      expect(queue().getAllByRole("listitem")).toHaveLength(1);
      expect(queue().getByText(title)).toBeInTheDocument();
    }
  });

  it("places mixed evidence counters in the most severe freshness bucket", async () => {
    const user = userEvent.setup();
    const freshnessItems = [
      workspaceItem({ id: "mixed", code: "M1", title: "Mixed freshness control", evidenceTotal: 2, evidenceExpiring: 1, evidenceExpired: 1, justification: " ", status: "operational", reviewState: "missing_rationale", position: 1 }),
      workspaceItem({ id: "expiring-only", code: "M2", title: "Only expiring control", evidenceTotal: 1, evidenceExpiring: 1, evidenceExpired: 0, justification: " ", status: "operational", reviewState: "missing_rationale", position: 2 }),
    ];
    renderWorkspace(undefined, freshnessItems);

    await user.selectOptions(screen.getByRole("combobox", { name: "Evidence freshness" }), "expiring");
    expect(queue().getAllByRole("listitem")).toHaveLength(1);
    expect(queue().getByText("Only expiring control")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Evidence freshness" }), "expired");
    expect(queue().getAllByRole("listitem")).toHaveLength(1);
    expect(queue().getByText("Mixed freshness control")).toBeInTheDocument();
  });

  it("reconciles a clean selection for Reviewed and search filters", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Reviewed 1" }));
    expect(screen.getByRole("heading", { name: "A.6.3 Information security awareness" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("heading", { name: "A.6.3 Information security awareness" })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search controls" }));
    await user.type(screen.getByRole("searchbox", { name: "Search controls" }), "physical security");
    expect(screen.getByRole("heading", { name: "A.7.1 Physical security perimeters" })).toBeInTheDocument();
  });

  it("shows empty detail and no save commands when filters have no result", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await user.type(screen.getByRole("searchbox", { name: "Search controls" }), "no matching control");

    expect(queue().getByText("No controls match these filters.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No control selected" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });

  it("retains a dirty filtered-out selection visibly with an explicit notice", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.type(screen.getByRole("textbox", { name: "Rationale" }), "Unsaved rationale");
    await user.click(screen.getByRole("button", { name: "Reviewed 1" }));

    expect(queue().getByText("Policies for information security")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A.5.1 Policies for information security" })).toBeInTheDocument();
    expect(screen.getByText("This control is shown because it has unsaved changes and does not match the current filters.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Rationale" })).toHaveValue("Unsaved rationale");
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
    expect(screen.getByRole("combobox", { name: "Implementation status filter" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Evidence freshness" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Why this matters")).toBeInTheDocument();
    expect(screen.getByText("What you decide here")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByRole("textbox", { name: "Evidence references" })).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getByText("No evidence records are currently mapped to this control.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Linked work" }));
    expect(screen.getByText("No linked open work")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("No recent item history")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View audit trail" })).toHaveAttribute("href", "/app/activity");
  });

  it("renders real linked evidence, task records, and recent item audit events", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(queue().getByRole("button", { name: "Review A.8.8 Management of technical vulnerabilities" }));

    await user.click(screen.getByRole("tab", { name: "Evidence" }));
    const evidenceRecord = screen.getByText("Quarterly scanner report").closest("li");
    expect(evidenceRecord).not.toBeNull();
    expect(within(evidenceRecord as HTMLElement).getByText("Expired")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Linked work" }));
    expect(screen.getByRole("link", { name: "Renew scanner report" })).toHaveAttribute("href", "/app/tasks/task-31");
    expect(screen.getByRole("link", { name: "Patch critical findings" })).toHaveAttribute("href", "/app/tasks/task-32");

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("9 Jul 2026, 14:15")).toBeInTheDocument();
  });

  it("implements roving tab focus with arrow, Home, and End keys", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const decision = screen.getByRole("tab", { name: "Decision" });
    const evidence = screen.getByRole("tab", { name: "Evidence" });
    const history = screen.getByRole("tab", { name: "History" });

    expect(decision).toHaveAttribute("tabindex", "0");
    expect(evidence).toHaveAttribute("tabindex", "-1");
    decision.focus();
    await user.keyboard("{ArrowRight}");
    expect(evidence).toHaveFocus();
    expect(evidence).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(history).toHaveFocus();
    await user.keyboard("{Home}");
    expect(decision).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(history).toHaveFocus();
  });

  it("uses list markup without the legacy data-table dependency", () => {
    const { container } = renderWorkspace();

    expect(container.querySelector("ol")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(container.querySelector(".data-table-wrap")).not.toBeInTheDocument();
    expect(container.querySelector('[style*="min-width"]')).not.toBeInTheDocument();
  });

  it("keeps the scoped SoA CSS on semantic tokens without clipping outer focus rings", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const soaCss = css.slice(css.indexOf("/* SoA review workspace */"));
    const workspaceRule = soaCss.match(/\.soa-review-workspace\{([^}]*)\}/)?.[1] ?? "";
    const detailRule = soaCss.match(/\.soa-review-detail\{([^}]*)\}/)?.[1] ?? "";

    expect(soaCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(workspaceRule).not.toContain("overflow:hidden");
    expect(detailRule).not.toContain("overflow:hidden");
  });
});
