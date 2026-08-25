import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  transition: vi.fn(),
  raiseTask: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/app/app/monitoring/actions", () => ({
  transitionGitHubFindingAction: hoisted.transition,
  raiseTaskFromFindingAction: hoisted.raiseTask,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hoisted.refresh }) }));

import {
  OfficialGitHubEvidenceCard,
  OfficialGitHubFindingCard,
} from "./github-record-provenance";

const common = {
  repository: {
    id: "50000000-0000-4000-8000-000000000001",
    name: "mukta2701/ComplianceHub",
    url: "https://github.com/mukta2701/ComplianceHub",
  },
  checkId: "github.branch.force_pushes",
  catalogueSummary: "A verified technical pass was materialised as approved evidence.",
  observedAt: "2026-08-25T08:00:00.000Z",
  freshUntil: "2026-08-26T08:00:00.000Z",
  materialisedAt: "2026-08-25T08:01:00.000Z",
  freshness: "current" as const,
  ruleVersion: "github-repository-v1",
  mappingVersion: "github-iso-27001-v1",
  mappingChecksum: "b".repeat(64),
  isoControlReferences: ["A.8.25", "A.8.32"],
};

describe("official GitHub provenance cards", () => {
  it("renders safe evidence provenance, focuses exact selection, and exposes no generic mutation controls", async () => {
    render(<OfficialGitHubEvidenceCard record={{ ...common, evidenceId: "30000000-0000-4000-8000-000000000001" }} selected />);

    const article = screen.getByRole("article", { name: "Official GitHub evidence github.branch.force_pushes" });
    expect(article).toHaveAttribute("id", "evidence-30000000-0000-4000-8000-000000000001");
    expect(article).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(article).toHaveFocus());
    expect(within(article).getByRole("link", { name: "Open mukta2701/ComplianceHub on GitHub" }))
      .toHaveAttribute("href", "https://github.com/mukta2701/ComplianceHub");
    expect(within(article).getByText("Current through 26 Aug 2026, 09:00")).toBeInTheDocument();
    expect(within(article).getByText(/does not certify ISO\/IEC 27001 compliance/i)).toBeInTheDocument();
    expect(within(article).getByText("A.8.25 · A.8.32")).toBeInTheDocument();
    for (const mutation of ["Link", "Remove link", "Supersede", "Withdraw", "Edit"]) {
      expect(within(article).queryByRole("button", { name: mutation })).not.toBeInTheDocument();
      expect(within(article).queryByRole("link", { name: mutation })).not.toBeInTheDocument();
    }
  });

  it.each(["admin", "member"] as const)("keeps official finding lifecycle read-only for %s", (role) => {
    render(<OfficialGitHubFindingCard
      record={{
        ...common,
        findingId: "40000000-0000-4000-8000-000000000001",
        severity: "high",
        firstDetectedAt: "2026-08-24T08:00:00.000Z",
        mostRecentDetectedAt: "2026-08-25T08:00:00.000Z",
        allowedTransitions: ["open", "in_progress", "exception_requested", "risk_accepted"],
      }}
      status="acknowledged"
      taskId={null}
      role={role}
      selected={false}
    />);

    const article = screen.getByRole("article", { name: "Official GitHub finding github.branch.force_pushes" });
    expect(within(article).getByText(/automatically resolves only after a newer fresh passing check/i)).toBeInTheDocument();
    expect(within(article).getByText(/does not certify ISO\/IEC 27001 compliance or change readiness/i)).toBeInTheDocument();
    expect(within(article).getByText(/read-only for your role/i)).toBeInTheDocument();
    expect(within(article).queryByRole("button")).not.toBeInTheDocument();
    expect(within(article).queryByText("Resolve")).not.toBeInTheDocument();
    expect(within(article).queryByText("Reopen")).not.toBeInTheDocument();
  });

  it("offers Owners only the verified transition states and existing atomic task action with one live region", () => {
    render(<OfficialGitHubFindingCard
      record={{
        ...common,
        catalogueSummary: "A verified issue was materialised as an approved finding.",
        findingId: "40000000-0000-4000-8000-000000000001",
        severity: "critical",
        firstDetectedAt: "2026-08-24T08:00:00.000Z",
        mostRecentDetectedAt: "2026-08-25T08:00:00.000Z",
        allowedTransitions: ["open", "acknowledged", "in_progress", "exception_requested", "risk_accepted"],
      }}
      status="open"
      taskId={null}
      role="owner"
      selected={false}
    />);

    const article = screen.getByRole("article", { name: "Official GitHub finding github.branch.force_pushes" });
    const select = within(article).getByRole("combobox", { name: "Review state" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Acknowledged", "In progress", "Exception requested", "Risk accepted",
    ]);
    expect(within(article).getByRole("button", { name: "Update review state" })).toBeInTheDocument();
    expect(within(article).getByRole("button", { name: "Raise remediation task" })).toBeInTheDocument();
    expect(within(article).getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(within(article).getByText(/does not certify ISO\/IEC 27001 compliance or change readiness/i)).toBeInTheDocument();
    expect(within(article).queryByText("Resolve")).not.toBeInTheDocument();
    expect(within(article).queryByText("Reopen")).not.toBeInTheDocument();
  });

  it("resets a preserved transition choice after refreshed lifecycle props change", async () => {
    const record = {
      ...common, findingId: "40000000-0000-4000-8000-000000000001", severity: "high" as const,
      firstDetectedAt: "2026-08-24T08:00:00.000Z", mostRecentDetectedAt: "2026-08-25T08:00:00.000Z",
      allowedTransitions: ["acknowledged", "in_progress"] as Array<"acknowledged" | "in_progress">,
    };
    const { rerender } = render(<OfficialGitHubFindingCard record={record} status="open" taskId={null} role="owner" selected={false} />);
    const select = screen.getByRole("combobox", { name: "Review state" });
    fireEvent.change(select, { target: { value: "acknowledged" } });

    rerender(<OfficialGitHubFindingCard
      record={{ ...record, allowedTransitions: ["open", "in_progress"] }}
      status="acknowledged" taskId={null} role="owner" selected={false}
    />);

    await waitFor(() => expect(select).toHaveValue("open"));
  });
});
