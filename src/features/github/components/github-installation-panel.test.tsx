import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  refresh: vi.fn(),
  selectRepository: vi.fn(),
}));

vi.mock("@/app/app/integrations/actions", () => ({
  setGitHubRepositorySelectedAction: hoisted.selectRepository,
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
    expect(within(region).getByRole("article", { name: "Adtecher GitHub installation" })).toHaveTextContent("Active");
    expect(within(region).getByRole("checkbox", {
      name: "Allow ComplianceHub to read and include Adtecher/compliancehub in monitoring",
    })).toBeEnabled();
    expect(within(region).getByRole("link", { name: "Open GitHub monitoring" })).toHaveAttribute("href", "/app/monitoring");
    expect(within(region).getByRole("link", { name: "Manage repository access" })).toHaveAttribute("href", "/api/github/setup");
    expect(within(region).getByRole("link", { name: "Open Adtecher/compliancehub on GitHub" })).toHaveAttribute(
      "href", "https://github.com/Adtecher/compliancehub",
    );
    for (const operationalText of [
      "Collection health", "Freshness", "Collected", "Stale", "checks need attention", "Recheck Adtecher",
    ]) {
      expect(within(region).queryByText(operationalText, { exact: false })).not.toBeInTheDocument();
    }
    expect(within(region).queryByText(/shadow results do not change/i)).not.toBeInTheDocument();
  });

  it("warns when repository access is all-repositories or permissions need attention", () => {
    render(<GitHubInstallationPanel
      installations={[{ ...installation, repository_selection: "all", permissions_ok: false }]}
      repositories={[repository()]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
    />);

    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(2);
    expect(notes[0]).toHaveTextContent(/access to all repositories/i);
    expect(notes[1]).toHaveTextContent(/permissions need attention/i);
  });

  it("is read-only for Admins and Members while preserving full accessible labels", async () => {
    const user = userEvent.setup();
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository()]}
      canManageInstallation={false}
      canManageRepositoryScope={false}
    />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Allow ComplianceHub to read and include Adtecher/compliancehub in monitoring",
    });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText("Only workspace Owners can change repository scope.")).toBeVisible();
    expect(screen.getByText("Only workspace Owners can set up or manage repository access.")).toBeVisible();
    await user.click(checkbox);
    expect(hoisted.selectRepository).not.toHaveBeenCalled();
  });

  it("offers plain-language setup when repository access is not connected", () => {
    render(<GitHubInstallationPanel
      installations={[]}
      repositories={[]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
    />);

    expect(screen.getByText("No GitHub repository access connected")).toBeVisible();
    expect(screen.getByRole("link", { name: "Set up repository access" })).toHaveAttribute("href", "/api/github/setup");
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
    expect(screen.getByRole("status")).toHaveTextContent("Could not update repository scope. Please try again.");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("disables an unavailable repository and explains why", () => {
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ available: false })]}
      canManageInstallation={true}
      canManageRepositoryScope={true}
    />);

    expect(screen.getByRole("checkbox", { name: /include Adtecher\/compliancehub in monitoring/ })).toBeDisabled();
    expect(screen.getByText("Unavailable to this GitHub App installation.")).toBeVisible();
  });
});
