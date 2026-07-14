import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./oauth-connect-button", () => ({
  OAuthConnectButton: ({ provider }: { provider: string }) => <button>Connect {provider === "github" ? "GitHub" : "Jira"}</button>,
}));
vi.mock("./actions", () => ({
  addAlertChannelAction: vi.fn(),
  configureOAuthConnectionAction: vi.fn(),
  revokeAlertChannelAction: vi.fn(),
  revokeConnectionAction: vi.fn(),
  setAlertChannelEnabledAction: vi.fn(),
  setIntegrationConnectionEnabledAction: vi.fn(),
}));

import { ConnectionsCatalog } from "./connections-catalog";

const connections = [{
  id: "github-1",
  provider: "github" as const,
  label: "Production GitHub",
  config: { owner: "acme", repo: "isms" },
  connection_mode: "oauth" as const,
  enabled: true,
}, {
  id: "jira-1",
  provider: "jira" as const,
  label: "Engineering Jira",
  config: {},
  connection_mode: "oauth" as const,
  enabled: false,
}];

const alertChannels = [{
  id: "slack-1",
  type: "slack",
  label: "#compliance-alerts",
  min_severity: "high",
  enabled: true,
}];

describe("ConnectionsCatalog", () => {
  it("places supplied Settings navigation between the page heading and provider grid", () => {
    render(<ConnectionsCatalog
      connections={connections}
      alertChannels={alertChannels}
      navigation={<nav aria-label="Settings tabs"><a href="/app/settings">Settings</a></nav>}
    />);

    const heading = screen.getByRole("heading", { name: "Connections" });
    const navigation = screen.getByRole("navigation", { name: "Settings tabs" });
    const grid = screen.getByTestId("connections-grid");
    expect(heading.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(navigation.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("presents GitHub, Jira, and Slack as a clean provider catalogue", () => {
    render(<ConnectionsCatalog connections={connections} alertChannels={alertChannels} />);

    expect(screen.getByRole("heading", { name: "Connections" })).toBeVisible();
    expect(screen.queryByRole("searchbox", { name: "Search connections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Development" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alerts" })).not.toBeInTheDocument();
    expect(screen.getByTestId("connections-grid")).toHaveClass("connections-grid");
    const githubCard = screen.getByRole("article", { name: "GitHub connection" });
    const jiraCard = screen.getByRole("article", { name: "Jira connection" });
    const slackCard = screen.getByRole("article", { name: "Slack connection" });
    expect(githubCard).toHaveClass("connection-card");
    expect(githubCard).toHaveTextContent("Connected");
    expect(githubCard).toHaveTextContent("acme/isms");
    expect(within(githubCard).getByText("acme/isms")).toHaveClass("connection-card-target");
    const githubCardFooter = within(githubCard).getByRole("button", { name: "Manage" }).parentElement;
    expect(githubCardFooter).toHaveClass("connection-card-footer");
    expect(githubCardFooter).not.toHaveClass("connection-actions");
    expect(jiraCard).toHaveTextContent("Setup required");
    expect(jiraCard).toHaveTextContent("Project not selected");
    expect(slackCard).toHaveTextContent("Connected");
    expect(slackCard).toHaveTextContent("#compliance-alerts");
    expect(screen.queryByRole("heading", { name: "Monitoring sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evidence sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alert channels" })).not.toBeInTheDocument();
    expect(screen.queryByText(/OAuth|SSO|Nango/i)).not.toBeInTheDocument();
  });

  it("summarizes providers with multiple configured targets", () => {
    render(<ConnectionsCatalog
      connections={[...connections, {
        id: "github-2",
        provider: "github",
        label: "Internal GitHub",
        config: { owner: "acme", repo: "internal" },
        connection_mode: "oauth",
        enabled: true,
      }]}
      alertChannels={[...alertChannels, {
        id: "slack-2",
        type: "slack",
        label: "#security-alerts",
        min_severity: "critical",
        enabled: true,
      }]}
    />);

    expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveTextContent("2 connections");
    expect(screen.getByRole("article", { name: "Slack connection" })).toHaveTextContent("2 channels");
    expect(screen.queryByRole("searchbox", { name: "Search connections" })).not.toBeInTheDocument();
  });

  it("shows paused providers while preserving setup-required precedence", () => {
    render(<ConnectionsCatalog
      connections={[{
        id: "github-paused",
        provider: "github",
        label: "Paused GitHub",
        config: { owner: "acme", repo: "isms" },
        connection_mode: "oauth",
        enabled: false,
      }, {
        id: "jira-setup",
        provider: "jira",
        label: "Jira setup",
        config: {},
        connection_mode: "oauth",
        enabled: true,
      }]}
      alertChannels={[{
        id: "slack-paused",
        type: "slack",
        label: "#paused-alerts",
        min_severity: "high",
        enabled: false,
      }]}
    />);

    const githubCard = screen.getByRole("article", { name: "GitHub connection" });
    expect(within(githubCard).getByText("Paused")).toBeVisible();
    expect(within(githubCard).getByRole("button", { name: "Manage" })).toHaveClass("secondary");

    const slackCard = screen.getByRole("article", { name: "Slack connection" });
    expect(within(slackCard).getByText("Paused")).toBeVisible();
    expect(within(slackCard).getByRole("button", { name: "Manage" })).toHaveClass("secondary");

    const jiraCard = screen.getByRole("article", { name: "Jira connection" });
    expect(within(jiraCard).getByText("Setup required")).toBeVisible();
    expect(within(jiraCard).getByRole("button", { name: "Continue setup" })).toHaveClass("primary");
  });

  it("shows a provider as connected when any record is enabled", () => {
    render(<ConnectionsCatalog
      connections={[]}
      alertChannels={[{
        id: "slack-paused",
        type: "slack",
        label: "#paused-alerts",
        min_severity: "high",
        enabled: false,
      }, {
        id: "slack-active",
        type: "slack",
        label: "#active-alerts",
        min_severity: "critical",
        enabled: true,
      }]}
    />);

    const slackCard = screen.getByRole("article", { name: "Slack connection" });
    expect(within(slackCard).getByText("Connected")).toBeVisible();
    expect(within(slackCard).getByRole("button", { name: "Manage" })).toHaveClass("secondary");

    const githubCard = screen.getByRole("article", { name: "GitHub connection" });
    expect(within(githubCard).getByText("Not connected")).toBeVisible();
    expect(within(githubCard).getByRole("button", { name: "Connect" })).toHaveClass("primary");
  });

  it("opens only the selected provider management panel", async () => {
    const user = userEvent.setup();
    render(<ConnectionsCatalog connections={connections} alertChannels={alertChannels} />);

    const githubCard = screen.getByRole("article", { name: "GitHub connection" });
    const githubManage = within(githubCard).getByRole("button", { name: "Manage" });
    expect(githubManage).toHaveAttribute("aria-expanded", "false");
    expect(githubManage).toHaveAttribute("aria-controls", "connection-management-panel");
    await user.click(githubManage);
    expect(githubManage).toHaveAttribute("aria-expanded", "true");
    const githubPanel = screen.getByRole("region", { name: "Manage GitHub" });
    expect(githubPanel).toHaveFocus();
    expect(within(githubPanel).getByText("acme/isms")).toBeVisible();

    const slackCard = screen.getByRole("article", { name: "Slack connection" });
    const slackManage = within(slackCard).getByRole("button", { name: "Manage" });
    await user.click(slackManage);
    expect(githubManage).toHaveAttribute("aria-expanded", "false");
    expect(slackManage).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("region", { name: "Manage GitHub" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Manage Slack" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add Slack channel" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close Slack panel" }));
    expect(screen.queryByRole("region", { name: "Manage Slack" })).not.toBeInTheDocument();
    expect(slackManage).toHaveFocus();
    expect(slackManage).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a focused connection panel for a provider that is not connected", async () => {
    const user = userEvent.setup();
    render(<ConnectionsCatalog connections={[]} alertChannels={[]} />);

    const githubCard = screen.getByRole("article", { name: "GitHub connection" });
    expect(githubCard).toHaveTextContent("Not connected");
    await user.click(within(githubCard).getByRole("button", { name: "Connect" }));

    const panel = screen.getByRole("region", { name: "Connect GitHub" });
    expect(within(panel).getByRole("button", { name: "Connect GitHub" })).toBeVisible();
  });
});
