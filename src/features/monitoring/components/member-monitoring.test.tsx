import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemberMonitoring } from "./member-monitoring";

describe("MemberMonitoring", () => {
  it("shows only connected-system summaries and active findings", () => {
    const { container } = render(<MemberMonitoring data={{
      connectedSystems: [{ id: "source-1", provider: "slack", label: "Production Slack", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: [{
        id: "finding-1", controlRef: "A.8.32", severity: "high", title: "Branch protection disabled",
        detail: "The default branch is not protected.", status: "open", detectedAt: "2026-01-03T00:00:00Z", origin: "legacy",
      }],
      officialGitHubFindings: [],
    }} />);

    expect(screen.getByRole("heading", { name: "Continuous monitoring" })).toBeInTheDocument();
    expect(screen.getByText("Production Slack")).toBeInTheDocument();
    expect(screen.getByText("Branch protection disabled")).toBeInTheDocument();
    expect(screen.getByText("The default branch is not protected.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Active findings" }).closest(".monitor-findings-card"))
      .toHaveAttribute("id", "active-findings");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
    for (const forbidden of ["Connect source", "Run checks now", "Disconnect", "Acknowledge", "Resolve", "Raise task", "Alert channels", "Add Slack channel"]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it("uses read-only empty states with no setup instruction", () => {
    render(<MemberMonitoring data={{ connectedSystems: [], findings: [], officialGitHubFindings: [] }} />);

    const banner = screen.getByText("No recorded active findings").closest(".monitor-banner");
    expect(banner).toHaveTextContent("Monitoring status is not yet confirmed.");
    expect(banner?.querySelector(".monitor-dot")).toHaveClass("neutral");
    expect(screen.getByText("No recorded active findings.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Other monitored systems" })).not.toBeInTheDocument();
    expect(screen.queryByText(/connect a system/i)).not.toBeInTheDocument();
  });

  it("counts an active GitHub installation once and hides a duplicate legacy source", () => {
    render(<MemberMonitoring hasActiveGitHubInstallation data={{
      connectedSystems: [{ id: "source-1", provider: "github", label: "Legacy GitHub", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: [],
      officialGitHubFindings: [],
    }} />);

    expect(screen.getByText("No recorded active findings").closest(".monitor-banner")).toHaveTextContent("1 system monitored");
    expect(screen.queryByText("Legacy GitHub")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Other monitored systems" })).not.toBeInTheDocument();
  });

  it("places other systems after active findings and before technical review", () => {
    render(<MemberMonitoring
      githubMonitoring={<section aria-label="GitHub monitoring" />}
      githubTechnicalReview={<details><summary>Technical review and recovery</summary></details>}
      data={{
        connectedSystems: [{ id: "source-1", provider: "slack", label: "Production Slack", connectedAt: "2026-01-01T00:00:00Z" }],
        findings: [{
          id: "finding-1", controlRef: "A.8.32", severity: "high", title: "Branch protection disabled",
          detail: "The default branch is not protected.", status: "open", detectedAt: "2026-01-03T00:00:00Z", origin: "legacy",
        }],
        officialGitHubFindings: [],
      }}
    />);

    const findings = screen.getByRole("heading", { name: "Active findings" });
    const otherSystems = screen.getByRole("heading", { name: "Other monitored systems" });
    const technical = screen.getByText("Technical review and recovery");
    expect(findings.compareDocumentPosition(otherSystems) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(otherSystems.compareDocumentPosition(technical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    const article = screen.getByRole("article", { name: "GitHub finding: Force pushes are allowed" });
    expect(article).toHaveAttribute("aria-current", "true");
    expect(screen.queryByText("Provider title must stay hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("Provider detail must stay hidden.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
