import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ recheck: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/app/monitoring/github-actions", () => ({ recheckGitHubInstallationAction: hoisted.recheck }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hoisted.refresh }) }));

import { GitHubCollectionHealthPanel } from "./github-collection-health-panel";
import type { GitHubInstallationSummary } from "./github-installation-panel";
import type { GitHubRepositoryMonitoringSummary } from "./github-collection-health-panel";

const installation: GitHubInstallationSummary = {
  id: "10000000-0000-4000-8000-000000000010", account_login: "Adtecher", status: "active",
  repository_selection: "selected", permissions_ok: true,
};
const repository: GitHubRepositoryMonitoringSummary = {
  repository_id: "10000000-0000-4000-8000-000000000011", installation_id: installation.id,
  full_name: "Adtecher/compliancehub", html_url: "https://github.com/Adtecher/compliancehub",
  selected: true, available: true, latest_run_id: "10000000-0000-4000-8000-000000000012",
  latest_status: "succeeded", latest_failed_count: 2, last_completed_collection_at: "2026-09-01T08:00:00Z",
};

function renderPanel({ installations = [installation], repositories = [repository], role = "owner" }: {
  installations?: GitHubInstallationSummary[];
  repositories?: GitHubRepositoryMonitoringSummary[];
  role?: "owner" | "admin" | "member";
} = {}) {
  return render(<GitHubCollectionHealthPanel installations={installations} repositories={repositories} nowIso="2026-09-01T10:00:00Z" role={role} />);
}

function repoArticle(name: string) {
  return screen.getByRole("article", { name: `${name} monitoring status` });
}

describe("GitHubCollectionHealthPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.recheck.mockResolvedValue({ ok: true, message: "GitHub check finished." });
  });

  it("explains the read-only GitHub boundary without exposing implementation language", () => {
    renderPanel({ role: "admin" });
    const region = screen.getByRole("region", { name: "GitHub monitoring" });
    expect(within(region).getByText("GitHub access reads repository settings and metadata and never changes GitHub.")).toBeVisible();
    expect(within(region).getByText("A check can update ComplianceHub's own evidence and findings.")).toBeVisible();
    for (const forbidden of ["official collection", "control room", "shadow", "materialisation", "mapping pack"]) {
      expect(within(region).queryByText(new RegExp(forbidden, "i"))).not.toBeInTheDocument();
    }
  });

  it("shows disconnected guidance by role", () => {
    const { rerender } = render(<GitHubCollectionHealthPanel installations={[]} repositories={[]} nowIso="2026-09-01T10:00:00Z" role="owner" />);
    expect(screen.getByText("GITHUB MONITORING")).toBeVisible();
    expect(screen.queryByText("CONNECTED MONITORING")).not.toBeInTheDocument();
    expect(screen.getByText("GitHub is not connected.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/app/integrations");
    rerender(<GitHubCollectionHealthPanel installations={[]} repositories={[]} nowIso="2026-09-01T10:00:00Z" role="member" />);
    expect(screen.getByText("GitHub is not connected. Ask a workspace Owner or Admin to manage the connection.")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Connect GitHub" })).not.toBeInTheDocument();
  });

  it("shows connected-without-selection guidance and keeps non-Owners read-only", () => {
    renderPanel({ repositories: [], role: "admin" });
    expect(screen.getByText("No repositories are selected for GitHub monitoring.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Choose repositories" })).toHaveAttribute("href", "/app/integrations");
    expect(screen.queryByRole("button", { name: "Check GitHub now" })).not.toBeInTheDocument();
    expect(screen.getByText("Only workspace Owners can check GitHub from here.")).toBeVisible();
  });

  it("disables Owner checks until at least one selected repository is available", () => {
    const { rerender } = render(<GitHubCollectionHealthPanel installations={[installation]} repositories={[]} nowIso="2026-09-01T10:00:00Z" role="owner" />);
    expect(screen.getByRole("button", { name: "Check GitHub now" })).toBeDisabled();
    expect(screen.getByText("Select at least one available repository before checking GitHub.")).toBeVisible();

    rerender(<GitHubCollectionHealthPanel
      installations={[installation]}
      repositories={[{ ...repository, available: false }]}
      nowIso="2026-09-01T10:00:00Z"
      role="owner"
    />);
    expect(screen.getByRole("button", { name: "Check GitHub now" })).toBeDisabled();
    expect(screen.getByText("No selected repositories are currently available to check.")).toBeVisible();
  });

  it("maps every repository run and freshness state with human-readable last-check times", () => {
    const variants: GitHubRepositoryMonitoringSummary[] = [
      { ...repository, latest_run_id: null, latest_status: null, latest_failed_count: null, last_completed_collection_at: null },
      { ...repository, repository_id: "21", full_name: "Adtecher/running", latest_status: "running", latest_failed_count: 0 },
      { ...repository, repository_id: "22", full_name: "Adtecher/current", latest_failed_count: 0 },
      { ...repository, repository_id: "23", full_name: "Adtecher/issue", latest_failed_count: 1 },
      { ...repository, repository_id: "24", full_name: "Adtecher/partial", latest_status: "partial", latest_failed_count: 3 },
      { ...repository, repository_id: "25", full_name: "Adtecher/failed", latest_status: "failed", latest_failed_count: 0 },
      { ...repository, repository_id: "26", full_name: "Adtecher/rate-limited", latest_status: "rate_limited", latest_failed_count: 0 },
      { ...repository, repository_id: "27", full_name: "Adtecher/stale", latest_failed_count: 0, last_completed_collection_at: "2026-08-30T22:00:00Z" },
    ];
    renderPanel({ repositories: variants });
    expect(within(repoArticle("Adtecher/compliancehub")).getByText("Ready for first check")).toBeVisible();
    expect(within(repoArticle("Adtecher/running")).getByText("Checking now")).toBeVisible();
    expect(within(repoArticle("Adtecher/current")).getByText("Up to date")).toBeVisible();
    expect(repoArticle("Adtecher/current")).toHaveTextContent(/Last checked 1 Sept 2026/);
    expect(within(repoArticle("Adtecher/issue")).getByText("1 check needs attention")).toBeVisible();
    expect(within(repoArticle("Adtecher/partial")).getByText("Some checks could not be completed")).toBeVisible();
    expect(within(repoArticle("Adtecher/partial")).getByText("3 checks need attention")).toBeVisible();
    expect(within(repoArticle("Adtecher/failed")).getByText("Check failed")).toBeVisible();
    expect(within(repoArticle("Adtecher/rate-limited")).getByText("GitHub rate limit reached")).toBeVisible();
    expect(within(repoArticle("Adtecher/stale")).getByText("Needs a new check")).toBeVisible();
    expect(repoArticle("Adtecher/stale")).toHaveTextContent(/Last checked 30 Aug 2026/);
  });

  it("shows installation access attention and disables unsafe Owner checks", () => {
    renderPanel({ installations: [{ ...installation, status: "suspended", permissions_ok: false, repository_selection: "all" }], repositories: [{ ...repository, available: false }] });
    expect(screen.getByRole("button", { name: "Check GitHub now" })).toBeDisabled();
    expect(screen.getByText(/connection is suspended/i)).toBeVisible();
    expect(screen.getByText(/permissions need attention/i)).toBeVisible();
    expect(screen.getByText(/not currently available to this GitHub connection/i)).toBeVisible();
  });

  it("lets installation and repository access problems dominate formerly-current health", () => {
    const secondInstallation = { ...installation, id: "10000000-0000-4000-8000-000000000020", account_login: "SecondOrg" };
    renderPanel({
      installations: [{ ...installation, permissions_ok: false }, secondInstallation],
      repositories: [
        { ...repository, latest_failed_count: 0 },
        { ...repository, repository_id: "31", installation_id: secondInstallation.id, full_name: "SecondOrg/unavailable", available: false, latest_failed_count: 0 },
      ],
    });

    expect(within(repoArticle("Adtecher/compliancehub")).getByText("GitHub connection needs attention")).toBeVisible();
    expect(within(repoArticle("Adtecher/compliancehub")).queryByText("Up to date")).not.toBeInTheDocument();
    expect(within(repoArticle("SecondOrg/unavailable")).getByText("Repository access needs attention")).toBeVisible();
    expect(within(repoArticle("SecondOrg/unavailable")).queryByText("Up to date")).not.toBeInTheDocument();
  });

  it("uses an accessible Owner pending state and refreshes only after success", async () => {
    const user = userEvent.setup();
    let finish!: (value: { ok: true; message: string }) => void;
    hoisted.recheck.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderPanel();
    const button = screen.getByRole("button", { name: "Check GitHub now" });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Checking GitHub…");
    expect(Object.fromEntries(hoisted.recheck.mock.calls[0][0] as FormData)).toEqual({ installationId: installation.id });
    finish({ ok: true, message: "GitHub check finished." });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("GitHub check finished."));
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(hoisted.refresh).toHaveBeenCalledOnce();
  });

  it("keeps feedback adjacent to each installation and normalises implementation wording", async () => {
    const user = userEvent.setup();
    const secondInstallation = { ...installation, id: "10000000-0000-4000-8000-000000000020", account_login: "SecondOrg" };
    hoisted.recheck.mockResolvedValueOnce({
      ok: true,
      message: "Official GitHub recheck finished: 1 checked, 0 deferred, 0 failed.",
    });
    renderPanel({
      installations: [installation, secondInstallation],
      repositories: [repository, { ...repository, repository_id: "31", installation_id: secondInstallation.id, full_name: "SecondOrg/repo" }],
    });

    const first = screen.getByRole("article", { name: "Adtecher GitHub monitoring" });
    const second = screen.getByRole("article", { name: "SecondOrg GitHub monitoring" });
    await user.click(within(first).getByRole("button", { name: "Check GitHub now" }));

    await waitFor(() => expect(within(first).getByRole("status")).toHaveTextContent("GitHub check finished. Monitoring status is refreshed."));
    expect(within(first).getByRole("status")).not.toHaveTextContent(/official|recheck/i);
    expect(within(second).getByRole("status")).toBeEmptyDOMElement();
    for (const installationCard of [first, second]) {
      const action = within(installationCard).getByRole("button", { name: "Check GitHub now" });
      const status = within(installationCard).getByRole("status");
      const repositoryList = installationCard.querySelector(".github-repository-list");
      expect(repositoryList).not.toBeNull();
      expect(action.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(status.compareDocumentPosition(repositoryList!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(hoisted.refresh).toHaveBeenCalledOnce();
  });

  it("shows a safe nearby error and does not refresh when an Owner check rejects", async () => {
    const user = userEvent.setup();
    hoisted.recheck.mockRejectedValueOnce(new Error("provider-sensitive-detail"));
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Check GitHub now" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("GitHub could not be checked. Please try again.");
    expect(status).not.toHaveTextContent("provider-sensitive-detail");
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it("does not refresh or expose action wording when the check returns a failure", async () => {
    const user = userEvent.setup();
    hoisted.recheck.mockResolvedValueOnce({ ok: false, message: "Official GitHub recheck failed: provider-sensitive-detail" });
    renderPanel();
    const installationCard = screen.getByRole("article", { name: "Adtecher GitHub monitoring" });

    await user.click(within(installationCard).getByRole("button", { name: "Check GitHub now" }));

    await waitFor(() => expect(within(installationCard).getByRole("status")).toHaveTextContent("GitHub could not be checked. Please try again."));
    expect(within(installationCard).getByRole("status")).not.toHaveTextContent(/official|recheck|provider-sensitive-detail/i);
    expect(hoisted.refresh).not.toHaveBeenCalled();
  });

  it("does not expose connection setup controls inside Monitoring", () => {
    renderPanel();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Install GitHub App|Manage GitHub App/i })).not.toBeInTheDocument();
  });
});
