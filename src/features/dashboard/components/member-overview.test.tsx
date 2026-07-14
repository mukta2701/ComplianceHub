import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemberOverview } from "./member-overview";

describe("MemberOverview", () => {
  it("shows a calm personal summary with only curated destinations", () => {
    render(<MemberOverview data={{
      organisationName: "Example Ltd",
      jobTitle: "Developer",
      policies: { approved: 4, acceptedCurrent: 3 },
      connectedSystems: [
        { id: "source-1", provider: "github", label: "Production GitHub", connectedAt: "2026-01-01T00:00:00Z" },
        { id: "source-2", provider: "jira", label: "Delivery Jira", connectedAt: "2026-01-02T00:00:00Z" },
      ],
      findings: { active: 2, highOrCritical: 1 },
      leadershipReport: { publishedAt: "2026-07-14T07:30:00Z" },
    }} />);

    expect(screen.getByRole("heading", { name: "Welcome to Example Ltd" })).toBeInTheDocument();
    expect(screen.getByText("Developer · Read-only member view")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 current policies accepted")).toBeInTheDocument();
    expect(screen.getByText("Production GitHub, Delivery Jira")).toBeInTheDocument();
    expect(screen.getByText("2 active findings · 1 high or critical")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review policies" })).toHaveAttribute("href", "/app/policies");
    expect(screen.getByRole("link", { name: "View monitoring" })).toHaveAttribute("href", "/app/monitoring");
    expect(screen.getByRole("link", { name: "Open leadership report" })).toHaveAttribute("href", "/app/reports/readiness");
    expect(screen.getByText(/Published 14 Jul 2026/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Review policies",
      "View monitoring",
      "Open leadership report",
    ]);
  });

  it("uses truthful read-only empty states", () => {
    render(<MemberOverview data={{
      organisationName: "Example Ltd",
      jobTitle: null,
      policies: { approved: 0, acceptedCurrent: 0 },
      connectedSystems: [],
      findings: { active: 0, highOrCritical: 0 },
      leadershipReport: null,
    }} />);

    expect(screen.getByText("No approved policies are available yet.")).toBeInTheDocument();
    expect(screen.getByText("No connected systems are currently visible.")).toBeInTheDocument();
    expect(screen.getByText("No active findings.")).toBeInTheDocument();
    expect(screen.getByText("No leadership report has been published for members yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open leadership report" })).not.toBeInTheDocument();
  });
});
