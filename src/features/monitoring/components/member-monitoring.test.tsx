import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemberMonitoring } from "./member-monitoring";

describe("MemberMonitoring", () => {
  it("shows only connected-system summaries and active findings", () => {
    const { container } = render(<MemberMonitoring data={{
      connectedSystems: [{ id: "source-1", provider: "github", label: "Production GitHub", connectedAt: "2026-01-01T00:00:00Z" }],
      findings: [{
        id: "finding-1", controlRef: "A.8.32", severity: "high", title: "Branch protection disabled",
        detail: "The default branch is not protected.", status: "open", detectedAt: "2026-01-03T00:00:00Z",
      }],
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
    render(<MemberMonitoring data={{ connectedSystems: [], findings: [] }} />);

    expect(screen.getByText("No systems are currently being monitored for this workspace.")).toBeInTheDocument();
    expect(screen.getByText("No active findings are currently visible.")).toBeInTheDocument();
    expect(screen.queryByText(/connect a system/i)).not.toBeInTheDocument();
  });
});
