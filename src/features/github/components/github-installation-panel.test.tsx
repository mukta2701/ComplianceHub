import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  refresh: vi.fn(),
  selectRepository: vi.fn(),
  disconnectInstallation: vi.fn(),
}));

vi.mock("@/app/app/integrations/actions", () => ({
  setGitHubRepositorySelectedAction: hoisted.selectRepository,
  disconnectGitHubInstallationAction: hoisted.disconnectInstallation,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hoisted.refresh }) }));

import {
  GitHubInstallationPanel,
  type GitHubInstallationSummary,
  type GitHubRepositoryConfigurationSummary,
} from "./github-installation-panel";

const INSTALLATION_ID = "10000000-0000-4000-8000-000000000010";
const installation: GitHubInstallationSummary = {
  id: INSTALLATION_ID,
  account_login: "Adtecher",
  status: "active",
  repository_selection: "selected",
  permissions_ok: true,
  health: "healthy",
  health_diagnostic_code: null,
  last_successful_reconciliation_at: null,
};

function repository(
  overrides: Partial<GitHubRepositoryConfigurationSummary> = {},
): GitHubRepositoryConfigurationSummary {
  return {
    repository_id: "10000000-0000-4000-8000-000000000011",
    installation_id: INSTALLATION_ID,
    full_name: "Adtecher/compliancehub",
    html_url: "https://github.com/Adtecher/compliancehub",
    visibility: "private",
    default_branch: "main",
    archived: false,
    selected: true,
    available: true,
    ...overrides,
  };
}

describe("GitHubInstallationPanel configuration boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.selectRepository.mockResolvedValue({ ok: true, message: "Repository scope updated." });
  });

  it("shows connection and repository configuration without operational collection state", () => {
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository()]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
    />);

    const region = screen.getByRole("region", { name: "GitHub repository access" });
    expect(within(region).getByText("READ-ONLY GITHUB MONITORING")).toBeVisible();
    expect(region).toHaveTextContent("ComplianceHub reads selected repositories for monitoring and never changes GitHub.");
    expect(within(region).getByRole("article", { name: "Adtecher GitHub installation" })).toHaveTextContent("Healthy");
    expect(within(region).getByText("Healthy")).toHaveClass("pill", "green");
    expect(within(region).getByRole("checkbox", {
      name: "Allow ComplianceHub to read and include Adtecher/compliancehub in monitoring",
    })).toBeEnabled();
    expect(within(region).getByRole("link", { name: "Open GitHub monitoring" })).toHaveAttribute("href", "/app/monitoring");
    expect(within(region).getByRole("link", { name: "Manage repository access" })).toHaveAttribute("href", "/api/github/setup");
    expect(within(region).getByRole("link", { name: "Open Adtecher/compliancehub on GitHub" })).toHaveAttribute(
      "href", "https://github.com/Adtecher/compliancehub",
    );
    for (const operationalText of [
      "Collection health", "Collected", "Stale", "checks need attention", "Recheck Adtecher",
    ]) {
      expect(within(region).queryByText(operationalText, { exact: false })).not.toBeInTheDocument();
    }
    expect(within(region).queryByText(/shadow results do not change/i)).not.toBeInTheDocument();
  });

  it("warns when repository access is all-repositories or permissions need attention", () => {
    render(<GitHubInstallationPanel
      installations={[{
        ...installation,
        repository_selection: "all",
        permissions_ok: false,
        health: "owner_action_required",
        health_diagnostic_code: "permission_mismatch",
      }]}
      repositories={[repository()]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
    />);

    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(/access to all repositories/i);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(/GitHub App permissions no longer match/i);
  });

  it("shows Admins facts and safe Owner guidance without mutation controls", () => {
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository()]}
      canManageInstallation={false}
      canManageRepositoryScope={false}
    />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Selected for ComplianceHub monitoring.")).toBeVisible();
    expect(screen.queryByText(/Only workspace Owners can/)).not.toBeInTheDocument();
    expect(hoisted.selectRepository).not.toHaveBeenCalled();
  });

  it("shows the exact approved read permissions, full scope totals, and Owner-only protected controls", () => {
    render(<GitHubInstallationPanel
      installations={[{
        ...installation,
        health: "healthy",
        health_diagnostic_code: null,
        last_successful_reconciliation_at: "2026-09-15T11:55:00.000Z",
        permission_labels: [
          "Metadata — read",
          "Administration — read",
          "Actions — read",
          "Vulnerability alerts — read",
          "Security events — read",
          "Secret scanning alerts — read",
        ],
        installation_settings_url: "https://github.com/organizations/Adtecher/settings/installations/77",
      }]}
      repositories={[
        repository({ selected: true }),
        repository({ repository_id: "10000000-0000-4000-8000-000000000012", full_name: "Adtecher/available", selected: false }),
        repository({ repository_id: "10000000-0000-4000-8000-000000000013", full_name: "Adtecher/historical", selected: false, available: false }),
      ]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
      now="2026-09-15T12:00:00.000Z"
    />);

    const region = screen.getByRole("region", { name: "GitHub repository access" });
    expect(within(region).getByText("Healthy")).toBeVisible();
    expect(within(region).getByText("GitHub is connected and was checked 5 minutes ago. No action is needed.")).toBeVisible();
    expect(within(region).getByText("2 repositories available to this GitHub App; 1 selected in ComplianceHub.")).toBeVisible();
    expect(within(region).getByText("1 historical repository is unavailable and cannot be selected.")).toBeVisible();
    for (const permission of [
      "Metadata — read", "Administration — read", "Actions — read", "Vulnerability alerts — read",
      "Security events — read", "Secret scanning alerts — read",
    ]) expect(within(region).getByText(permission)).toBeVisible();
    expect(within(region).queryByText(/contents/i)).not.toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Open GitHub installation settings" })).toHaveAttribute(
      "href", "https://github.com/organizations/Adtecher/settings/installations/77",
    );
    expect(within(region).getByRole("button", { name: "Disconnect from ComplianceHub" })).toBeEnabled();
  });

  it("keeps the same connection facts for Admins but removes all GitHub management controls", () => {
    render(<GitHubInstallationPanel
      installations={[{
        ...installation,
        health: "owner_action_required",
        health_diagnostic_code: "permission_mismatch",
        last_successful_reconciliation_at: null,
        permission_labels: ["Metadata — read"],
        installation_settings_url: "https://github.com/organizations/Adtecher/settings/installations/77",
      }]}
      repositories={[repository()]}
      canManageInstallation={false}
      canManageRepositoryScope={false}
      now="2026-09-15T12:00:00.000Z"
    />);

    expect(screen.getByText("Owner action required")).toBeVisible();
    expect(screen.getByText(/GitHub App permissions no longer match the approved read-only access/)).toBeVisible();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Ask a workspace Owner to review the GitHub App permissions.");
    expect(screen.queryByRole("link", { name: "Manage repository access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open GitHub installation settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect from ComplianceHub" })).not.toBeInTheDocument();
  });

  it("reports a local-only disconnect without claiming the GitHub App was removed", async () => {
    const user = userEvent.setup();
    hoisted.disconnectInstallation.mockResolvedValueOnce({
      ok: true,
      message: "ComplianceHub is disconnected. Its GitHub App installation was not removed from GitHub.",
    });
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository()]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
      now="2026-09-15T12:00:00.000Z"
    />);

    await user.click(screen.getByRole("button", { name: "Disconnect from ComplianceHub" }));
    await waitFor(() => expect(screen.getByText("ComplianceHub is disconnected. Its GitHub App installation was not removed from GitHub.")).toBeVisible());
    expect(Object.fromEntries(hoisted.disconnectInstallation.mock.calls[0][0] as FormData)).toEqual({
      installationId: INSTALLATION_ID,
    });
    expect(screen.getByText("ComplianceHub is disconnected. Its GitHub App installation was not removed from GitHub.")).toHaveTextContent("not removed from GitHub");
  });

  it("offers role-correct plain-language setup when repository access is not connected", () => {
    render(<GitHubInstallationPanel
      installations={[]}
      repositories={[]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
    />);

    expect(screen.getByText("No GitHub repository access connected")).toBeVisible();
    expect(screen.getByRole("link", { name: "Set up repository access" })).toHaveAttribute("href", "/api/github/setup");
    expect(screen.queryByText(/Ask a workspace Owner/)).not.toBeInTheDocument();

    render(<GitHubInstallationPanel
      installations={[]}
      repositories={[]}
      canManageInstallation={false}
      canManageRepositoryScope={false}
    />);
    expect(screen.getByText("Ask a workspace Owner to set up GitHub repository access.")).toBeVisible();
    expect(screen.queryAllByRole("link", { name: "Set up repository access" })).toHaveLength(1);
  });

  it("optimistically changes one repository and rolls only that repository back on failure", async () => {
    const user = userEvent.setup();
    let resolveSelection!: (value: { ok: false; message: string }) => void;
    hoisted.selectRepository.mockReturnValue(new Promise((resolve) => { resolveSelection = resolve; }));
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[
        repository({ selected: false }),
        repository({
          repository_id: "10000000-0000-4000-8000-000000000012",
          full_name: "Adtecher/second",
          html_url: "https://github.com/Adtecher/second",
          selected: false,
        }),
      ]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
    />);

    const first = screen.getByRole("checkbox", { name: /include Adtecher\/compliancehub in monitoring/ });
    const second = screen.getByRole("checkbox", { name: /include Adtecher\/second in monitoring/ });
    await user.click(first);
    expect(first).toBeChecked();
    expect(first).toBeDisabled();
    expect(first).toHaveAttribute("aria-busy", "true");
    expect(second).toBeEnabled();
    expect(Object.fromEntries(hoisted.selectRepository.mock.calls[0][0] as FormData)).toEqual({
      repositoryId: "10000000-0000-4000-8000-000000000011",
      selected: "true",
    });

    resolveSelection({ ok: false, message: "Could not update repository scope. Please try again." });
    await waitFor(() => expect(first).not.toBeChecked());
    expect(screen.getAllByRole("status").at(-1)).toHaveTextContent("Could not update repository scope. Please try again.");
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("disables an unavailable repository and explains why", () => {
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ available: false })]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
    />);

    expect(screen.getByRole("checkbox", { name: /previously selected, unavailable, and not currently monitored/i })).toBeDisabled();
    expect(screen.getByText("Previously selected, unavailable, and not currently monitored.")).toBeVisible();
  });

  it.each([true, false])("treats selected unavailable repositories as not currently monitored for %s controls", (canManage) => {
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ selected: true, available: false })]}
      canManageInstallation={canManage}
      canManageRepositoryScope={canManage}
    />);

    expect(screen.getByText("Previously selected, unavailable, and not currently monitored.")).toBeVisible();
    expect(screen.queryByText("Selected for ComplianceHub monitoring.")).not.toBeInTheDocument();
    if (canManage) {
      expect(screen.getByRole("checkbox", { name: /previously selected, unavailable, and not currently monitored/i })).toBeDisabled();
    } else {
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    }
  });

  it.each([
    ["healthy", null, "Healthy", "green"],
    ["retrying", null, "Retrying", "amber"],
    ["owner_action_required", "permission_mismatch", "Owner action required", "red"],
    ["disconnected", null, "Disconnected", "neutral"],
  ] as const)("maps %s health to the %s Pill class", (health, diagnostic, label, tone) => {
    render(<GitHubInstallationPanel
      installations={[{ ...installation, health, health_diagnostic_code: diagnostic }]}
      repositories={[repository()]}
      canManageInstallation={false}
      canManageRepositoryScope={false}
    />);

    expect(screen.getByText(label, { exact: true })).toHaveClass("pill", tone);
  });
});
