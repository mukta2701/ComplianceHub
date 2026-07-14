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
  it("presents GitHub, Jira, and Slack as a clean provider catalogue", () => {
    render(<ConnectionsCatalog connections={connections} alertChannels={alertChannels} />);

    expect(screen.getByRole("heading", { name: "Connections" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search connections" })).toHaveClass("connections-search");
    expect(screen.getByTestId("connections-grid")).toHaveClass("connections-grid");
    expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveClass("connection-card");
    expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveTextContent("Connected");
    expect(screen.getByRole("article", { name: "Jira connection" })).toHaveTextContent("Setup required");
    expect(screen.getByRole("article", { name: "Slack connection" })).toHaveTextContent("Connected");
    expect(screen.queryByRole("heading", { name: "Monitoring sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evidence sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alert channels" })).not.toBeInTheDocument();
    expect(screen.queryByText(/OAuth|SSO|Nango/i)).not.toBeInTheDocument();
  });

  it("filters the catalogue by search text and category", async () => {
    const user = userEvent.setup();
    render(<ConnectionsCatalog connections={connections} alertChannels={alertChannels} />);

    await user.type(screen.getByRole("searchbox", { name: "Search connections" }), "jira");
    expect(screen.getByRole("article", { name: "Jira connection" })).toBeVisible();
    expect(screen.queryByRole("article", { name: "GitHub connection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Slack connection" })).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search connections" }));
    await user.click(screen.getByRole("button", { name: "Alerts" }));
    expect(screen.getByRole("article", { name: "Slack connection" })).toBeVisible();
    expect(screen.queryByRole("article", { name: "Jira connection" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alerts" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens only the selected provider management panel", async () => {
    const user = userEvent.setup();
    render(<ConnectionsCatalog connections={connections} alertChannels={alertChannels} />);

    const githubCard = screen.getByRole("article", { name: "GitHub connection" });
    await user.click(within(githubCard).getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("region", { name: "Manage GitHub" })).toBeVisible();
    expect(screen.getByText("acme/isms")).toBeVisible();

    const slackCard = screen.getByRole("article", { name: "Slack connection" });
    await user.click(within(slackCard).getByRole("button", { name: "Manage" }));
    expect(screen.queryByRole("region", { name: "Manage GitHub" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Manage Slack" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add Slack channel" })).toBeVisible();
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
