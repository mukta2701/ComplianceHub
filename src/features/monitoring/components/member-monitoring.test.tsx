import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemberMonitoring } from "./member-monitoring";

describe("MemberMonitoring", () => {
  it("shows only connected-system summaries and active findings", () => {
    const { container } = render(<MemberMonitoring data={{
      connectedSystems: [{ id: "source-1", provider: "github", label: "Production GitHub", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: [{
        id: "finding-1", controlRef: "A.8.32", severity: "high", title: "Branch protection disabled",
        detail: "The default branch is not protected.", status: "open", detectedAt: "2026-01-03T00:00:00Z", origin: "legacy",
      }],
      officialGitHubFindings: [],
    }} />);

    expect(screen.getByRole("heading", { name: "Continuous monitoring" })).toBeInTheDocument();
    expect(screen.getByText("Production GitHub")).toBeInTheDocument();
    expect(screen.getByText("Branch protection disabled")).toBeInTheDocument();
    expect(screen.getByText("The default branch is not protected.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
    for (const forbidden of ["Connect source", "Run checks now", "Disconnect", "Acknowledge", "Resolve", "Raise task", "Alert channels", "Add Slack channel"]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it("uses read-only empty states with no setup instruction", () => {
    render(<MemberMonitoring data={{ connectedSystems: [], findings: [], officialGitHubFindings: [] }} />);

    expect(screen.getByText("No systems are currently being monitored for this workspace.")).toBeInTheDocument();
    expect(screen.getByText("No active findings are currently visible.")).toBeInTheDocument();
    expect(screen.queryByText(/connect a system/i)).not.toBeInTheDocument();
  });

  it("replaces provider-derived finding text with safe official provenance and honours exact selection", () => {
    const findingId = "74000000-0000-4000-8000-000000000001";
    render(<MemberMonitoring selectedFinding={findingId} data={{
      connectedSystems: [],
      findings: [{
        id: findingId, controlRef: "A.8.32", severity: "high", title: "Provider title must stay hidden",
        detail: "Provider detail must stay hidden.", status: "open", detectedAt: "2026-08-25T08:00:00.000Z", origin: "github",
      }],
      officialGitHubFindings: [{
        findingId,
        repository: { id: "75000000-0000-4000-8000-000000000001", name: "mukta2701/ComplianceHub", url: "https://github.com/mukta2701/ComplianceHub" },
        checkId: "github.branch.force_pushes",
        catalogueSummary: "A verified issue was materialised as an approved finding.",
        observedAt: "2026-08-25T08:00:00.000Z", freshUntil: "2026-08-26T08:00:00.000Z", materialisedAt: "2026-08-25T08:01:00.000Z",
        freshness: "current", ruleVersion: "github-repository-v1", mappingVersion: "github-iso-27001-v1", mappingChecksum: "b".repeat(64),
        isoControlReferences: ["A.8.25"], severity: "high", firstDetectedAt: "2026-08-24T08:00:00.000Z", mostRecentDetectedAt: "2026-08-25T08:00:00.000Z",
        allowedTransitions: ["acknowledged", "in_progress", "exception_requested", "risk_accepted"],
      }],
    }} />);

    const article = screen.getByRole("article", { name: "Official GitHub finding github.branch.force_pushes" });
    expect(article).toHaveAttribute("aria-current", "true");
    expect(screen.queryByText("Provider title must stay hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("Provider detail must stay hidden.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
