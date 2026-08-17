import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  recheck: vi.fn(),
  refresh: vi.fn(),
  selectRepository: vi.fn(),
}));

vi.mock("@/app/app/integrations/actions", () => ({
  recheckGitHubInstallationAction: hoisted.recheck,
  setGitHubRepositorySelectedAction: hoisted.selectRepository,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hoisted.refresh }) }));

import {
  GitHubInstallationPanel,
  type GitHubInstallationSummary,
  type GitHubRepositoryShadowSummary,
} from "./github-installation-panel";

const INSTALLATION_ID = "10000000-0000-4000-8000-000000000010";

const installation: GitHubInstallationSummary = {
  id: INSTALLATION_ID,
  account_login: "Adtecher",
  status: "active",
  repository_selection: "selected",
  permissions_ok: true,
};

function repository(overrides: Partial<GitHubRepositoryShadowSummary> = {}): GitHubRepositoryShadowSummary {
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
    latest_run_id: "10000000-0000-4000-8000-000000000012",
    latest_status: "succeeded",
    latest_failed_count: 2,
    last_completed_collection_at: "2026-08-17T18:00:00Z",
    ...overrides,
  };
}

describe("GitHubInstallationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.recheck.mockResolvedValue({
      ok: true,
      message: "Recheck complete.",
      summary: {
        installationsChecked: 1,
        repositoriesChecked: 1,
        observationsStored: 15,
        repositoriesFailed: 0,
        repositoriesDeferred: 0,
        runsPartial: 0,
      },
    });
    hoisted.selectRepository.mockResolvedValue({ ok: true, message: "Repository scope updated." });
  });

  it("keeps installation, collection, and freshness health independent", () => {
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[
        repository(),
        repository({
          repository_id: "10000000-0000-4000-8000-000000000021",
          full_name: "Adtecher/running",
          html_url: "https://github.com/Adtecher/running",
          latest_status: "running",
          last_completed_collection_at: "2026-08-16T08:00:00Z",
        }),
        repository({
          repository_id: "10000000-0000-4000-8000-000000000031",
          full_name: "Adtecher/invalid-time",
          html_url: "https://github.com/Adtecher/invalid-time",
          latest_status: "partial",
          last_completed_collection_at: "not-a-date",
        }),
      ]}
      nowIso="2026-08-17T20:00:00Z"
    />);

    const installationCard = screen.getByRole("article", { name: "Adtecher GitHub installation" });
    expect(within(installationCard).getByText("Active")).toBeVisible();

    const collected = screen.getByRole("article", { name: "Adtecher/compliancehub repository" });
    expect(within(collected).getByText("Collected")).toBeVisible();
    expect(within(collected).getByText("Current")).toBeVisible();
    expect(within(collected).getByText("2 checks need attention")).toBeVisible();

    const running = screen.getByRole("article", { name: "Adtecher/running repository" });
    expect(within(running).getByText("Collection in progress")).toBeVisible();
    expect(within(running).getByText("Stale")).toBeVisible();

    const invalid = screen.getByRole("article", { name: "Adtecher/invalid-time repository" });
    expect(within(invalid).getByText("Partial collection")).toBeVisible();
    expect(within(invalid).getByText("Needs attention")).toBeVisible();
  });

  it("treats the exact 36-hour freshness boundary as stale and missing history as never collected", () => {
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[
        repository({
          repository_id: "10000000-0000-4000-8000-000000000041",
          full_name: "Adtecher/boundary",
          html_url: "https://github.com/Adtecher/boundary",
          last_completed_collection_at: "2026-08-16T08:00:00Z",
        }),
        repository({
          repository_id: "10000000-0000-4000-8000-000000000051",
          full_name: "Adtecher/new-repository",
          html_url: "https://github.com/Adtecher/new-repository",
          latest_run_id: null,
          latest_status: null,
          latest_failed_count: null,
          last_completed_collection_at: null,
        }),
      ]}
      nowIso="2026-08-17T20:00:00Z"
    />);

    expect(within(screen.getByRole("article", { name: "Adtecher/boundary repository" })).getByText("Stale")).toBeVisible();
    const newRepository = screen.getByRole("article", { name: "Adtecher/new-repository repository" });
    expect(within(newRepository).getByText("Never collected")).toBeVisible();
    expect(within(newRepository).getByText("No completed collection")).toBeVisible();
  });

  it("maps suspended, revoked, and permission-incomplete installations without conflating repository status", () => {
    render(<GitHubInstallationPanel
      installations={[
        { ...installation, id: "10000000-0000-4000-8000-000000000061", account_login: "Suspended-Co", status: "suspended" },
        { ...installation, id: "10000000-0000-4000-8000-000000000062", account_login: "Revoked-Co", status: "revoked" },
        { ...installation, id: "10000000-0000-4000-8000-000000000063", account_login: "Permission-Co", permissions_ok: false },
      ]}
      repositories={[]}
      nowIso="2026-08-17T20:00:00Z"
    />);

    expect(within(screen.getByRole("article", { name: "Suspended-Co GitHub installation" })).getByText("Suspended")).toBeVisible();
    expect(within(screen.getByRole("article", { name: "Revoked-Co GitHub installation" })).getByText("Revoked")).toBeVisible();
    expect(within(screen.getByRole("article", { name: "Permission-Co GitHub installation" })).getByText("Needs attention")).toBeVisible();
  });

  it("optimistically changes one labelled repository and rolls only that row back on failure", async () => {
    const user = userEvent.setup();
    let resolveSelection!: (value: { ok: false; message: string }) => void;
    hoisted.selectRepository.mockReturnValue(new Promise((resolve) => { resolveSelection = resolve; }));
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[
        repository({ selected: false }),
        repository({
          repository_id: "10000000-0000-4000-8000-000000000071",
          full_name: "Adtecher/second",
          html_url: "https://github.com/Adtecher/second",
          selected: false,
        }),
      ]}
      nowIso="2026-08-17T20:00:00Z"
    />);

    const first = screen.getByRole("checkbox", { name: "Select Adtecher/compliancehub for shadow collection" });
    const second = screen.getByRole("checkbox", { name: "Select Adtecher/second for shadow collection" });
    await user.click(first);

    expect(first).toBeChecked();
    expect(first).toBeDisabled();
    expect(second).toBeEnabled();
    expect(hoisted.selectRepository).toHaveBeenCalledWith(expect.any(FormData));
    const submitted = hoisted.selectRepository.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(submitted)).toEqual({
      repositoryId: "10000000-0000-4000-8000-000000000011",
      selected: "true",
    });

    resolveSelection({ ok: false, message: "Could not update repository scope. Please try again." });
    await waitFor(() => expect(first).not.toBeChecked());
    expect(first).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Could not update repository scope. Please try again.");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("rolls a failed second toggle back to the last locally confirmed selection", async () => {
    const user = userEvent.setup();
    hoisted.selectRepository
      .mockResolvedValueOnce({ ok: true, message: "Repository scope updated." })
      .mockResolvedValueOnce({ ok: false, message: "Could not update repository scope. Please try again." });
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ selected: false })]}
      nowIso="2026-08-17T20:00:00Z"
    />);

    const checkbox = screen.getByRole("checkbox", { name: "Select Adtecher/compliancehub for shadow collection" });
    await user.click(checkbox);
    await waitFor(() => expect(checkbox).toBeEnabled());
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(hoisted.selectRepository.mock.calls.map(([formData]) =>
      Object.fromEntries(formData as FormData).selected,
    )).toEqual(["true", "false"]);
  });

  it("retires a confirmed override when refreshed props catch up", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ selected: false })]}
      nowIso="2026-08-17T20:00:00Z"
    />);
    const checkbox = screen.getByRole("checkbox", { name: "Select Adtecher/compliancehub for shadow collection" });

    await user.click(checkbox);
    await waitFor(() => expect(checkbox).toBeEnabled());
    expect(checkbox).toBeChecked();

    rerender(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ selected: true })]}
      nowIso="2026-08-17T20:00:00Z"
    />);
    expect(checkbox).toBeChecked();

    rerender(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ selected: false })]}
      nowIso="2026-08-17T20:00:00Z"
    />);
    expect(checkbox).not.toBeChecked();
  });

  it("trusts a newer server selection when a pending toggle fails", async () => {
    const user = userEvent.setup();
    let resolveSecondToggle!: (value: { ok: false; message: string }) => void;
    hoisted.selectRepository
      .mockResolvedValueOnce({ ok: true, message: "Repository scope updated." })
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecondToggle = resolve; }));
    const { rerender } = render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ selected: false })]}
      nowIso="2026-08-17T20:00:00Z"
    />);
    const checkbox = screen.getByRole("checkbox", { name: "Select Adtecher/compliancehub for shadow collection" });

    await user.click(checkbox);
    await waitFor(() => expect(checkbox).toBeEnabled());
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();

    rerender(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ selected: true })]}
      nowIso="2026-08-17T20:00:00Z"
    />);
    expect(checkbox).not.toBeChecked();

    resolveSecondToggle({ ok: false, message: "Could not update repository scope. Please try again." });
    await waitFor(() => expect(checkbox).toBeEnabled());
    expect(checkbox).toBeChecked();

    rerender(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ selected: false })]}
      nowIso="2026-08-17T20:00:00Z"
    />);
    expect(checkbox).not.toBeChecked();
  });

  it("disables unavailable repositories with an explanation and keeps their full accessible label", () => {
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository({ available: false, selected: true })]}
      nowIso="2026-08-17T20:00:00Z"
    />);

    expect(screen.getByRole("checkbox", { name: "Select Adtecher/compliancehub for shadow collection" })).toBeDisabled();
    expect(screen.getByText("Unavailable to this GitHub App installation.")).toBeVisible();
  });

  it("shows recheck progress and reports the safe deferred-work aggregate", async () => {
    const user = userEvent.setup();
    let resolveRecheck!: (value: unknown) => void;
    hoisted.recheck.mockReturnValue(new Promise((resolve) => { resolveRecheck = resolve; }));
    render(<GitHubInstallationPanel
      installations={[installation]}
      repositories={[repository()]}
      nowIso="2026-08-17T20:00:00Z"
    />);

    await user.click(screen.getByRole("button", { name: "Recheck Adtecher" }));
    expect(screen.getByRole("button", { name: "Rechecking…" })).toBeDisabled();
    const submitted = hoisted.recheck.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(submitted)).toEqual({ installationId: INSTALLATION_ID });

    resolveRecheck({
      ok: true,
      message: "Recheck complete: 1 checked, 1 deferred, 0 failed.",
      summary: {
        installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15,
        repositoriesFailed: 0, repositoriesDeferred: 1, runsPartial: 0,
      },
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 deferred"));
    expect(screen.getByRole("button", { name: "Recheck Adtecher" })).toBeEnabled();
    expect(hoisted.refresh).toHaveBeenCalledOnce();
  });

  it("allows another installation to recheck while only the affected button is pending", async () => {
    const user = userEvent.setup();
    hoisted.recheck.mockImplementation(() => new Promise(() => {}));
    const secondInstallation = {
      ...installation,
      id: "10000000-0000-4000-8000-000000000081",
      account_login: "Second-Co",
    };
    render(<GitHubInstallationPanel
      installations={[installation, secondInstallation]}
      repositories={[]}
      nowIso="2026-08-17T20:00:00Z"
    />);

    await user.click(screen.getByRole("button", { name: "Recheck Adtecher" }));
    expect(screen.getByRole("button", { name: "Rechecking…" })).toBeDisabled();
    const second = screen.getByRole("button", { name: "Recheck Second-Co" });
    expect(second).toBeEnabled();
    await user.click(second);

    expect(hoisted.recheck).toHaveBeenCalledTimes(2);
  });
});
