"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Pill } from "@/components/ui";
import { setGitHubRepositorySelectedAction } from "@/app/app/integrations/actions";

export type GitHubInstallationSummary = {
  id: string;
  account_login: string;
  status: "active" | "suspended" | "revoked" | "needs_attention";
  repository_selection: "all" | "selected";
  permissions_ok: boolean;
};

export type GitHubRepositoryConfigurationSummary = {
  repository_id: string;
  installation_id: string;
  full_name: string;
  html_url: string;
  visibility: "public" | "private" | "internal";
  default_branch: string;
  archived: boolean;
  selected: boolean;
  available: boolean;
};

type SelectionState = {
  serverSelections: Record<string, boolean>;
  overrides: Record<string, boolean>;
};

function selectionSnapshot(
  repositories: GitHubRepositoryConfigurationSummary[],
): Record<string, boolean> {
  return Object.fromEntries(repositories.map((repository) => [repository.repository_id, repository.selected]));
}

function sameSelections(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return leftIds.length === rightIds.length && leftIds.every((id) => right[id] === left[id]);
}

function reconcileSelectionState(
  state: SelectionState,
  serverSelections: Record<string, boolean>,
): SelectionState {
  const overrides = { ...state.overrides };
  for (const [repositoryId, selected] of Object.entries(overrides)) {
    if (!(repositoryId in serverSelections) || serverSelections[repositoryId] === selected) {
      delete overrides[repositoryId];
    }
  }
  return { serverSelections, overrides };
}

function rollbackSelectionState(
  state: SelectionState,
  repositoryId: string,
  attemptServerSelected: boolean | undefined,
  previousSelected: boolean,
): SelectionState {
  const overrides = { ...state.overrides };
  const currentServerSelected = state.serverSelections[repositoryId];
  if (currentServerSelected !== attemptServerSelected || currentServerSelected === previousSelected) {
    delete overrides[repositoryId];
  } else {
    overrides[repositoryId] = previousSelected;
  }
  return { ...state, overrides };
}

function installationHealth(installation: GitHubInstallationSummary): { label: string; tone: string } {
  if (installation.status === "suspended") return { label: "Suspended", tone: "amber" };
  if (installation.status === "revoked") return { label: "Revoked", tone: "neutral" };
  if (installation.status === "active" && installation.permissions_ok) return { label: "Active", tone: "green" };
  return { label: "Needs attention", tone: "red" };
}

function repositoryDetail(repository: GitHubRepositoryConfigurationSummary): string {
  const details = [repository.visibility, `default ${repository.default_branch}`];
  if (repository.archived) details.push("archived");
  return details.join(" · ");
}

export function GitHubInstallationPanel({
  installations,
  repositories,
  canManageInstallation,
  canManageRepositoryScope,
}: {
  installations: GitHubInstallationSummary[];
  repositories: GitHubRepositoryConfigurationSummary[];
  canManageInstallation: boolean;
  canManageRepositoryScope: boolean;
}) {
  const router = useRouter();
  const serverSelections = selectionSnapshot(repositories);
  const [selectionState, setSelectionState] = useState<SelectionState>(() => ({
    serverSelections,
    overrides: {},
  }));
  if (!sameSelections(selectionState.serverSelections, serverSelections)) {
    setSelectionState(reconcileSelectionState(selectionState, serverSelections));
  }
  const [pendingRepositories, setPendingRepositories] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");

  async function changeRepository(
    repository: GitHubRepositoryConfigurationSummary,
    selected: boolean,
  ) {
    if (!canManageRepositoryScope || !repository.available || pendingRepositories.has(repository.repository_id)) return;
    const attemptServerSelected = selectionState.serverSelections[repository.repository_id];
    const previousSelected = selectionState.overrides[repository.repository_id] ?? repository.selected;
    setMessage("");
    setSelectionState((current) => ({
      ...current,
      overrides: { ...current.overrides, [repository.repository_id]: selected },
    }));
    setPendingRepositories((current) => new Set(current).add(repository.repository_id));
    const formData = new FormData();
    formData.set("repositoryId", repository.repository_id);
    formData.set("selected", String(selected));
    try {
      const result = await setGitHubRepositorySelectedAction(formData);
      setMessage(result.message);
      if (!result.ok) {
        setSelectionState((current) => rollbackSelectionState(
          current,
          repository.repository_id,
          attemptServerSelected,
          previousSelected,
        ));
      } else {
        router.refresh();
      }
    } catch {
      setSelectionState((current) => rollbackSelectionState(
        current,
        repository.repository_id,
        attemptServerSelected,
        previousSelected,
      ));
      setMessage("Could not update repository scope. Please try again.");
    } finally {
      setPendingRepositories((current) => {
        const next = new Set(current);
        next.delete(repository.repository_id);
        return next;
      });
    }
  }

  return <section className="github-shadow-panel" aria-labelledby="github-connection-title">
    <header className="github-shadow-panel-head">
      <div>
        <p className="eyebrow">READ-ONLY GITHUB MONITORING</p>
        <h2 id="github-connection-title">GitHub repository access</h2>
        <p>ComplianceHub reads selected repositories for monitoring and never changes GitHub.</p>
      </div>
      <div className="github-connection-actions">
        <Link className="button secondary" href="/app/monitoring">Open GitHub monitoring</Link>
        {canManageInstallation
          ? <a className="button primary" href="/api/github/setup">
            {installations.length > 0 ? "Manage repository access" : "Set up repository access"}
          </a>
          : <span className="field-hint">Only workspace Owners can set up or manage repository access.</span>}
      </div>
    </header>

    {installations.length === 0 ? <div className="github-shadow-empty">
      <strong>No GitHub repository access connected</strong>
      <p>Set up read-only access to choose which repositories ComplianceHub may include in monitoring.</p>
    </div> : <div className="github-installation-list">
      {installations.map((installation) => {
        const health = installationHealth(installation);
        const installationRepositories = repositories.filter((repository) => repository.installation_id === installation.id);
        return <article className="github-installation" aria-label={`${installation.account_login} GitHub installation`} key={installation.id}>
          <div className="github-installation-head">
            <div>
              <h3>{installation.account_login}</h3>
              <p>{installation.repository_selection === "selected" ? "Selected repositories" : "All repositories"}</p>
            </div>
            <dl className="github-health-facts">
              <div><dt>Connection status</dt><dd><Pill tone={health.tone}>{health.label}</Pill></dd></div>
            </dl>
          </div>

          {installation.repository_selection === "all" && <p className="github-configuration-note" role="note">
            This GitHub App installation has access to all repositories. Review the installation if you want GitHub to limit access to selected repositories.
          </p>}
          {!installation.permissions_ok && <p className="github-configuration-note" role="note">
            GitHub App permissions need attention. Manage the installation before relying on repository monitoring.
          </p>}
          {!canManageRepositoryScope && <p className="field-hint">Only workspace Owners can change repository scope.</p>}
          {installationRepositories.length === 0 ? <p className="github-repositories-empty">
            No repositories are available for this installation.
          </p> : <div className="github-repository-list">
            {installationRepositories.map((repository) => {
              const pending = pendingRepositories.has(repository.repository_id);
              return <article
                className="github-repository"
                aria-label={`${repository.full_name} repository scope`}
                aria-busy={pending}
                key={repository.repository_id}
              >
                <div className="github-repository-scope">
                  <label>
                    <input
                      type="checkbox"
                      checked={selectionState.overrides[repository.repository_id] ?? repository.selected}
                      disabled={!canManageRepositoryScope || !repository.available || pending}
                      aria-busy={pending}
                      onChange={(event) => void changeRepository(repository, event.target.checked)}
                    />
                    <span>Allow ComplianceHub to read and include {repository.full_name} in monitoring</span>
                  </label>
                  <div>
                    <a
                      href={repository.html_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${repository.full_name} on GitHub`}
                    >{repository.full_name}</a>
                    <p>{repositoryDetail(repository)}</p>
                    {!repository.available && <p className="field-hint">Unavailable to this GitHub App installation.</p>}
                  </div>
                </div>
              </article>;
            })}
          </div>}
        </article>;
      })}
    </div>}

    <p className="github-shadow-status" role="status" aria-live="polite" aria-atomic="true">{message}</p>
  </section>;
}
