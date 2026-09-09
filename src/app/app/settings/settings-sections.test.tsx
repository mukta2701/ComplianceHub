import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsSections } from "./settings-sections";

function renderSettings(initialSection?: "workspace" | "team" | "security" | "ai-assistance" | "connected-apps") {
  return render(
    <SettingsSections
      initialSection={initialSection}
      workspace={<p>Workspace content</p>}
      team={<p>Team content</p>}
      security={<p>Security content</p>}
      aiAssistance={<p>AI content</p>}
      connectedApps={<p>Connected assistants content</p>}
    />,
  );
}

afterEach(() => {
  window.history.replaceState({}, "", "/app/settings");
});

describe("SettingsSections", () => {
  it("shows the section named by the URL hash and treats legacy invitations as team", () => {
    window.history.replaceState({}, "", "/app/settings#invites");
    renderSettings();

    expect(screen.getByText("Team content")).toBeVisible();
    expect(screen.getByText("Workspace content")).not.toBeVisible();
    expect(screen.getByRole("link", { name: "Team members" })).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("link", { name: "Team members" })).toHaveAttribute("href", "/app/settings#team");
  });

  it("records a section change without duplicating the previous hash", () => {
    window.history.replaceState({}, "", "/app/settings#workspace");
    renderSettings();
    fireEvent.click(screen.getByRole("link", { name: "Team members" }));
    expect(window.location.hash).toBe("#team");
    expect(screen.getByText("Team content")).toBeVisible();
  });

  it("updates the visible section for hash and browser-history changes", () => {
    renderSettings("workspace");

    window.history.pushState({}, "", "/app/settings#security");
    fireEvent(window, new Event("popstate"));
    expect(screen.getByText("Security content")).toBeVisible();
    expect(screen.getByText("Workspace content")).not.toBeVisible();

    window.location.hash = "connected-apps";
    fireEvent(window, new Event("hashchange"));
    expect(screen.getByText("Connected assistants content")).toBeVisible();
    expect(screen.getByRole("link", { name: "Connected assistants" })).toHaveAttribute("aria-current", "location");
  });

  it("opens the team section when an invitation result returns without a hash", () => {
    renderSettings("team");

    expect(screen.getByText("Team content")).toBeVisible();
    expect(screen.getByText("Workspace content")).not.toBeVisible();
  });
});
