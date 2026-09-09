import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mockedActions = vi.hoisted(() => ({
  createAutomationTaskDraftAction: vi.fn(),
  generateAutomationExplanationAction: vi.fn(),
  recollectAutomationProposalAction: vi.fn(),
  reviewAutomationProposalAction: vi.fn(),
}));

vi.mock("./actions", () => mockedActions);

import { AutomationInbox, type AutomationInboxProposal } from "./automation-inbox";

const proposal: AutomationInboxProposal = {
  id: "proposal-1",
  targetType: "evidence",
  assignedTo: "owner-1",
  output: {
    title: "Review GitHub branch protection evidence",
    why: "A protected branch snapshot may support engineering controls.",
    recommendedAction: "Confirm the selected repositories are in scope.",
    confidence: "high",
    mappings: ["CC6.1", "A.8.25"],
  },
  createdAt: "2026-08-18T10:30:00.000Z",
  signal: {
    signalType: "github.branch_protection",
    summary: "Branch protection is enabled for the selected repositories.",
    confidence: "high",
    occurredAt: "2026-08-18T10:00:00.000Z",
    provider: "github",
    connectionLabel: "Local test · GitHub",
  },
  source: { title: "Branch protection settings", sourceUrl: "https://github.local/settings/branches", externalRef: "repo/example/main", observationKey: "observation-1", collectedOn: "2026-08-18" },
};

describe("AutomationInbox", () => {
  it("exposes provenance, limitations, and human-review controls", () => {
    render(<AutomationInbox proposals={[proposal]} currentUserId="owner-1" canCreateTaskDraft={true} aiEnabled={false} collectorVersion="sandbox-fake-1" collectorMode="deterministic sandbox" />);

    expect(screen.getByText("Branch protection settings")).toBeInTheDocument();
    expect(screen.getByText(/18 Aug 2026/)).toBeInTheDocument();
    expect(screen.getByText(/sandbox-fake-1/)).toBeInTheDocument();
    expect(screen.getByText(/Deterministic collection/i)).toBeInTheDocument();
    expect(screen.getByText("CC6.1")).toBeInTheDocument();
    expect(screen.getByText(/What this does not prove/i)).toBeInTheDocument();
    expect(screen.getByText(/Draft only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept as evidence" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use as draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create task draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recollect" })).toBeInTheDocument();
  });

  it("shows the keyed collection day and resource reference without a midnight timestamp", () => {
    render(<AutomationInbox proposals={[{ ...proposal, source: {
      title: "Branch protection settings", sourceUrl: "https://github.local/settings/branches",
      externalRef: "repo/example/main", observationKey: "observation-1", collectedOn: "2026-09-08",
    } }]} currentUserId="owner-1" canCreateTaskDraft={true} aiEnabled={false} collectorVersion="sandbox-fake-1" collectorMode="deterministic sandbox" />);

    expect(screen.getByText("Collected 08 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("Resource: repo/example/main")).toBeInTheDocument();
    expect(screen.queryByText(/00:00/)).not.toBeInTheDocument();
  });

  it("shows distinct recorded results for same-day observations sharing a resource", () => {
    const laterResult: AutomationInboxProposal = {
      ...proposal,
      id: "proposal-2",
      output: { ...proposal.output, title: "Review the later branch snapshot", why: "The later snapshot needs review." },
      signal: { ...proposal.signal, summary: "Branch protection is missing for two repositories." },
    };
    render(<AutomationInbox proposals={[proposal, laterResult]} currentUserId="owner-1" canCreateTaskDraft={true} aiEnabled={false} collectorVersion="sandbox-fake-1" collectorMode="deterministic sandbox" />);

    expect(screen.getAllByText("Recorded result")).toHaveLength(2);
    expect(screen.getByText("Branch protection is enabled for the selected repositories.")).toBeInTheDocument();
    expect(screen.getByText("Branch protection is missing for two repositories.")).toBeInTheDocument();
  });

  it("identifies an unkeyed source as legacy instead of deriving an observation date", () => {
    render(<AutomationInbox proposals={[{ ...proposal, source: {
      title: "Legacy branch protection", sourceUrl: null, externalRef: "repo/example/main",
      observationKey: null, collectedOn: null,
    }, createdAt: "2026-09-09T12:00:00.000Z" }]} currentUserId="owner-1" canCreateTaskDraft={true} aiEnabled={false} collectorVersion="sandbox-fake-1" collectorMode="deterministic sandbox" />);

    expect(screen.getByText("Legacy observation identity unknown")).toBeInTheDocument();
    expect(screen.getByText("Recorded date: 18 Aug 2026")).toBeInTheDocument();
    expect(screen.getByText("Resource: repo/example/main")).toBeInTheDocument();
    expect(screen.queryByText(/09 Sep 2026/)).not.toBeInTheDocument();
  });

  it("keeps filters and use-as-draft selection in the browser without calling a server action", async () => {
    const user = userEvent.setup();
    render(<AutomationInbox proposals={[proposal]} currentUserId="owner-1" canCreateTaskDraft={true} aiEnabled={false} collectorVersion="sandbox-fake-1" collectorMode="deterministic sandbox" />);

    await user.click(screen.getByRole("button", { name: "Use as draft" }));
    expect(screen.getByRole("status")).toHaveTextContent(/selected as a draft/i);
    await user.selectOptions(screen.getByLabelText("Filter automation drafts"), "github");
    expect(screen.getByRole("status")).toHaveTextContent(/selected as a draft/i);
    expect(mockedActions.createAutomationTaskDraftAction).not.toHaveBeenCalled();
    expect(mockedActions.generateAutomationExplanationAction).not.toHaveBeenCalled();
    expect(mockedActions.recollectAutomationProposalAction).not.toHaveBeenCalled();
    expect(mockedActions.reviewAutomationProposalAction).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before accepting a proposal", async () => {
    const user = userEvent.setup();
    render(<AutomationInbox proposals={[proposal]} currentUserId="owner-1" canCreateTaskDraft={true} aiEnabled={false} collectorVersion="sandbox-fake-1" collectorMode="deterministic sandbox" />);

    await user.click(screen.getByRole("button", { name: "Accept as evidence" }));
    expect(screen.getByRole("button", { name: "Confirm acceptance" })).toBeInTheDocument();
    expect(screen.queryByText("Evidence accepted")).not.toBeInTheDocument();
  });

  it("does not present a task proposal as compliance evidence", () => {
    render(<AutomationInbox proposals={[{ ...proposal, targetType: "task" }]} currentUserId="owner-1" canCreateTaskDraft={true} aiEnabled={false} collectorVersion="sandbox-fake-1" collectorMode="deterministic sandbox" />);

    expect(screen.queryByRole("button", { name: "Accept as evidence" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create task draft" })).toBeInTheDocument();
  });

  it("shows an explicit empty mapping state when a proposal has no suggestions", () => {
    render(<AutomationInbox proposals={[{ ...proposal, output: { ...proposal.output, mappings: [] } }]} currentUserId="owner-1" canCreateTaskDraft={true} aiEnabled={false} collectorVersion="sandbox-fake-1" collectorMode="deterministic sandbox" />);

    expect(screen.getByText("Suggested mappings")).toBeInTheDocument();
    expect(screen.getByText("No mapping suggested")).toBeInTheDocument();
  });
});
