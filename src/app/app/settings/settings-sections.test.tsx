import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsSections } from "./settings-sections";

function renderSettings(initialSection?: "workspace" | "team" | "security" | "customer-trust") {
  return render(
    <SettingsSections
      initialSection={initialSection}
      workspace={<p>Workspace content</p>}
      team={<p>Team content</p>}
      security={<p>Security content</p>}
      customerTrust={<p>Customer trust content</p>}
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

    window.location.hash = "customer-trust";
    fireEvent(window, new Event("hashchange"));
    expect(screen.getByText("Customer trust content")).toBeVisible();
    expect(screen.getByRole("link", { name: "Customer trust" })).toHaveAttribute("aria-current", "location");
  });

  it("opens the team section when an invitation result returns without a hash", () => {
    renderSettings("team");

    expect(screen.getByText("Team content")).toBeVisible();
    expect(screen.getByText("Workspace content")).not.toBeVisible();
  });

  it("keeps customer trust without separate AI or assistant settings", () => {
    renderSettings();

    expect(screen.queryByRole("link", { name: "AI assistance" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Customer trust" })).toHaveAttribute("href", "/app/settings#customer-trust");
    expect(screen.queryByRole("link", { name: "Connected assistants" })).not.toBeInTheDocument();
  });

  it("keeps narrow-screen invite stacking, touch targets and tab wrapping in owned CSS", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "settings-sections.module.css"), "utf8");

    // Invite fields stack full-width at ~600px (not only at 460px).
    expect(css).toMatch(/@media\s*\([^)]*max-width:\s*640px[^)]*\)[\s\S]*?\.inviteForm/);
    // Invite submit and invitation-result actions reach a 44px touch target.
    expect(css).toMatch(/\.inviteForm\s*>\s*button[\s\S]*?min-height:\s*44px/);
    expect(css).toMatch(/\.invitationResultActions[\s\S]*?min-height:\s*44px/);
    // Invite inputs stay readable on small screens (16px avoids iOS auto-zoom).
    expect(css).toMatch(/@media\s*\([^)]*max-width:\s*640px[^)]*\)[\s\S]*?font-size:\s*16px/);
    // Section tabs wrap or stay reachable without clipping at narrow widths.
    expect(css).toMatch(/@media\s*\([^)]*max-width:\s*640px[^)]*\)[\s\S]*?\.navigation/);
  });
});
