"use client";

import Link from "next/link";
import { useState } from "react";

import { Pill } from "@/components/ui";
import { setGitHubRepositorySelectedAction, disconnectGitHubInstallationAction } from "@/app/app/integrations/actions";
import {
  presentGitHubConnectionHealth,
  type GitHubConnectionPresentation,
} from "./github-connection-health";
import type { GitHubConnectionDiagnostic, GitHubConnectionHealth } from "../domain/connection-health";

export type GitHubInstallationSummary = {
  id: string;
  account_login: string;
  status: "active" | "suspended" | "revoked" | "needs_attention";
  repository_selection: "all" | "selected";
  permissions_ok: boolean;
  health: GitHubConnectionHealth;
  health_diagnostic_code: GitHubConnectionDiagnostic | null;
  last_successful_reconciliation_at: string | null;
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

const APPROVED_READ_PERMISSIONS = [
  "Metadata",
  "Administration",
  "Actions",
  "Dependabot alerts",
  "Code scanning alerts",
  "Secret scanning alerts",
];

const PRESENTATION_TONE: Record<GitHubConnectionPresentation["tone"], string> = {
  success: "green",
  warning: "amber",
  danger: "red",
  neutral: "neutral",
};

function DisconnectInstallationButton({
  installationId,
  onMessage,
}: {
  installationId: string;
  onMessage: (message: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);

  async function disconnect() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setPending(true);
    onMessage("");
    const formData = new FormData();
    formData.set("installationId", installationId);
    try {
      const result = await disconnectGitHubInstallationAction(formData);
      onMessage(result.message);
      if (result.ok) {
        setArmed(false);
      }
    } catch {
      onMessage("Could not disconnect the GitHub installation. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <span className="github-disconnect">
    <button
      className="button secondary"
      type="button"
      disabled={pending}
      aria-live="polite"
      onClick={() => void disconnect()}
    >{armed ? "Click again to confirm disconnect" : "Disconnect"}</button>
    {armed && !pending && <span className="field-hint">Disconnecting stops future checks. The GitHub-side installation stays unchanged.</span>}
  </span>;
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
  nowIso,
}: {
  installations: GitHubInstallationSummary[];
  repositories: GitHubRepositoryConfigurationSummary[];
  canManageInstallation: boolean;
  canManageRepositoryScope: boolean;
  nowIso: string;
}) {
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
        const presentation = presentGitHubConnectionHealth({
          health: installation.health,
          diagnostic: installation.health_diagnostic_code,
          lastSuccessfulReconciliationAt: installation.last_successful_reconciliation_at,
          now: nowIso,
        });
        const installationRepositories = repositories.filter((repository) => repository.installation_id === installation.id);
        const selectedCount = installationRepositories.filter((repository) => repository.selected).length;
        const availableCount = installationRepositories.filter((repository) => repository.available).length;
        return <article className="github-installation" aria-label={`${installation.account_login} GitHub installation`} key={installation.id}>
          <div className="github-installation-head">
            <div>
              <h3>{installation.account_login}</h3>
              <p>{installation.repository_selection === "selected" ? "Selected repositories" : "All repositories"}</p>
            </div>
            <dl className="github-health-facts">
              <div><dt>Connection status</dt><dd><Pill tone={PRESENTATION_TONE[presentation.tone]}>{presentation.label}</Pill></dd></div>
            </dl>
          </div>
          <p className="github-connection-summary">{presentation.summary}</p>
          {presentation.nextAction && <p className="github-connection-action"><strong>Next step:</strong> {presentation.nextAction}</p>}

          <p className="github-scope-totals">
            {installationRepositories.length} {installationRepositories.length === 1 ? "repository" : "repositories"}
            {` · ${selectedCount} selected · ${availableCount} available`}
          </p>
          {installation.permissions_ok ? <details className="github-access-details">
            <summary>Read-only access details</summary>
            <p><strong>Approved read-only access:</strong> {APPROVED_READ_PERMISSIONS.join(" · ")}</p>
          </details> : null}
          {canManageInstallation && installation.health !== "disconnected" && <DisconnectInstallationButton
            installationId={installation.id}
            onMessage={setMessage}
          />}
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
                    <span>Choose to include {repository.full_name} in monitoring</span>
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
