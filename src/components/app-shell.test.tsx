import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({ pathname: "/app" }));

vi.mock("next/navigation", () => ({ usePathname: () => hoisted.pathname }));
vi.mock("@/app/app/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("./alert-toaster", () => ({ AlertToaster: () => <a href="/app/monitoring">New monitoring alert</a> }));

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
  beforeEach(() => {
    hoisted.pathname = "/app";
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });

  it("makes the existing asset inventory discoverable for operators", () => {
    renderShell("owner");
    expect(screen.getByRole("link", { name: "Asset inventory" })).toHaveAttribute("href", "/app/assets");
  });

  it("identifies the workspace and current page in the header breadcrumb", () => {
    hoisted.pathname = "/app/policies/example-policy";
    renderShell("owner");

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Example Ltd" })).toHaveAttribute("href", "/app");
    expect(within(breadcrumb).getByRole("heading", { name: "Policies", level: 1 })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Policies" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps a closed drawer out of navigation and isolates its open state", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderShell("owner");
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Workspace navigation" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Page content").closest(".app-main")).toHaveAttribute("inert");
    expect(screen.getByText("New monitoring alert").closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Page content").closest(".app-main")).not.toHaveAttribute("inert");
  });

  it("focuses a drawer control before membership exists", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderShell(null);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
  });

  it("renders only the curated navigation with assigned work for a Member", () => {
    renderShell("member", "Developer");

    const navigation = screen.getByRole("navigation", { name: "Workspace" });
    expect(navigation).toHaveTextContent("OverviewComplianceAssigned tasksPoliciesFramework coverageMonitoringLeadership report");
    expect(navigation.querySelectorAll("a")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Framework coverage" })).toHaveAttribute("href", "/app/frameworks");
    expect(screen.getByText("Developer · Assigned work access")).toBeInTheDocument();
    expect(screen.getByText("Member view", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Assigned tasks" })).toHaveAttribute("href", "/app/tasks?filter=assigned");
    expect(screen.queryByRole("link", { name: "Trust Center" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifications, 2 unread" })).toHaveAttribute("href", "/app/notifications");
  });

  it.each(["owner", "admin"] as const)("keeps the full operational navigation for an %s", (role) => {
    renderShell(role);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gap assessment" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connections" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");
    expect(screen.getByText(role === "owner" ? "Owner" : "Admin", { selector: "span" })).toBeInTheDocument();
  });

  it("keeps Settings active and titles the page on the Connections route", () => {
    hoisted.pathname = "/app/integrations";
    renderShell("owner");

    expect(screen.queryByRole("link", { name: "Connections" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Connections", level: 1 })).toBeInTheDocument();
  });

  it("shows workspace setup without operational navigation before membership exists", () => {
    hoisted.pathname = "/app/onboarding";
    renderShell(null);

    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace setup", { selector: "span" })).toBeInTheDocument();
  });
});
