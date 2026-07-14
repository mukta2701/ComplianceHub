import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({ pathname: "/app" }));

vi.mock("next/navigation", () => ({ usePathname: () => hoisted.pathname }));
vi.mock("@/app/app/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("./alert-toaster", () => ({ AlertToaster: () => null }));

import { AppShell } from "./app-shell";

function renderShell(role: "owner" | "admin" | "member" | null, jobTitle: string | null = null) {
  return render(
    <AppShell
      organisationId="71000000-0000-4000-8000-000000000001"
      orgName="Example Ltd"
      orgInitials="EL"
      userInitials="PV"
      unreadCount={2}
      role={role}
      jobTitle={jobTitle}
    >
      <p>Page content</p>
    </AppShell>,
  );
}

describe("AppShell role-specific navigation", () => {
  beforeEach(() => { hoisted.pathname = "/app"; });

  it("renders only the curated read-only navigation for a Member", () => {
    renderShell("member", "Developer");

    const navigation = screen.getByRole("navigation", { name: "Workspace" });
    expect(navigation).toHaveTextContent("OverviewCompliancePoliciesFramework coverageMonitoringLeadership report");
    expect(navigation.querySelectorAll("a")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Framework coverage" })).toHaveAttribute("href", "/app/frameworks");
    expect(screen.getByText("Developer · Read only")).toBeInTheDocument();
    expect(screen.getByText("Member view", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Trust Center" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifications, 2 unread" })).toHaveAttribute("href", "/app/notifications");
  });

  it.each(["owner", "admin"] as const)("keeps the full operational navigation for an %s", (role) => {
    renderShell(role);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gap assessment" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText(role === "owner" ? "Owner" : "Admin", { selector: "span" })).toBeInTheDocument();
  });

  it("shows workspace setup without operational navigation before membership exists", () => {
    hoisted.pathname = "/app/onboarding";
    renderShell(null);

    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace setup", { selector: "span" })).toBeInTheDocument();
  });
});
