import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./jira/actions", () => ({
  configureJiraProjectsAction: vi.fn(),
  selectJiraSiteAction: vi.fn(),
}));

import { JiraSetupPanel } from "./jira-setup-panel";

describe("Jira setup panel", () => {
  it("offers the authorized Jira sites before connection creation", () => {
    render(<JiraSetupPanel step="site" setupId="97000000-0000-4000-8000-000000000102" sites={[{
      cloudId: "1324a887-45db-4bf4-8e99-ef0ff456d421",
      name: "Acme Jira",
      url: "https://acme.atlassian.net",
    }]} />);

    expect(screen.getByRole("heading", { name: "Choose your Jira site" })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Acme Jira/ })).toBeRequired();
    expect(screen.getByRole("button", { name: "Continue to projects" })).toBeVisible();
  });

  it("offers project scope as explicit opt in", () => {
    render(<JiraSetupPanel step="project" connectionId="97000000-0000-4000-8000-000000000101" projects={[{
      id: "10001",
      key: "SEC",
      name: "Security",
    }]} />);

    expect(screen.getByRole("heading", { name: "Choose Jira projects" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "SEC · Security" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save projects" })).toBeVisible();
  });
});
