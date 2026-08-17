"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Pill } from "@/components/ui";
import type { CollectionRequest } from "@/features/github/application/run-collection";
import {
  recheckGitHubInstallationAction,
  setGitHubRepositorySelectedAction,
} from "@/app/app/integrations/actions";

export type GitHubInstallationSummary = {
  id: string;
  account_login: string;
  status: "active" | "suspended" | "revoked" | "needs_attention";
  repository_selection: "all" | "selected";
  permissions_ok: boolean;
  updated_at: string;
  revoked_at: string | null;
};

export type GitHubRepositoryShadowSummary = {
  repository_id: string;
  installation_id: string;
  full_name: string;
  html_url: string;
  visibility: "public" | "private" | "internal";
  default_branch: string;
  archived: boolean;
  selected: boolean;
  available: boolean;
  last_seen_at: string;
  latest_run_id: string | null;
  latest_trigger_type: CollectionRequest["trigger"] | null;
  latest_status: "running" | "succeeded" | "partial" | "failed" | "rate_limited" | null;
  latest_diagnostic_code: string | null;
  latest_started_at: string | null;
  latest_completed_at: string | null;
  latest_observation_count: number | null;
  latest_passed_count: number | null;
  latest_failed_count: number | null;
  latest_unknown_count: number | null;
  latest_not_applicable_count: number | null;
  last_completed_collection_at: string | null;
};

function installationHealth(installation: GitHubInstallationSummary): { label: string; tone: string } {
  if (installation.status === "suspended") return { label: "Suspended", tone: "amber" };
  if (installation.status === "revoked") return { label: "Revoked", tone: "neutral" };
  if (installation.status === "active" && installation.permissions_ok) return { label: "Active", tone: "green" };
  return { label: "Needs attention", tone: "red" };
}

function collectionHealth(repository: GitHubRepositoryShadowSummary): { label: string; tone: string } {
  if (!repository.latest_run_id || !repository.latest_status) return { label: "Never collected", tone: "neutral" };
  if (repository.latest_status === "running") return { label: "Collection in progress", tone: "blue" };
  if (repository.latest_status === "partial") return { label: "Partial collection", tone: "amber" };
  if (repository.latest_status === "succeeded") return { label: "Collected", tone: "green" };
  return { label: "Needs attention", tone: "red" };
}

function freshnessHealth(
  repository: GitHubRepositoryShadowSummary,
  nowIso: string,
): { label: string; tone: string } {
  if (!repository.last_completed_collection_at) return { label: "No completed collection", tone: "neutral" };
  const now = new Date(nowIso).getTime();
  const completed = new Date(repository.last_completed_collection_at).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(completed)) return { label: "Needs attention", tone: "red" };
  return now >= completed + 36 * 60 * 60 * 1_000
    ? { label: "Stale", tone: "amber" }
    : { label: "Current", tone: "green" };
}

function repositoryDetail(repository: GitHubRepositoryShadowSummary): string {
  const details = [repository.visibility, `default ${repository.default_branch}`];
  if (repository.archived) details.push("archived");
  return details.join(" · ");
}

export function GitHubInstallationPanel({
  installations,
  repositories,
  nowIso,
}: {
  installations: GitHubInstallationSummary[];
  repositories: GitHubRepositoryShadowSummary[];
  nowIso: string;
}) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [pendingRepositories, setPendingRepositories] = useState<Set<string>>(() => new Set());
  const [recheckingInstallations, setRecheckingInstallations] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");

  async function changeRepository(repository: GitHubRepositoryShadowSummary, selected: boolean) {
    if (!repository.available || pendingRepositories.has(repository.repository_id)) return;
    setMessage("");
    setSelections((current) => ({ ...current, [repository.repository_id]: selected }));
    setPendingRepositories((current) => new Set(current).add(repository.repository_id));
    const formData = new FormData();
    formData.set("repositoryId", repository.repository_id);
    formData.set("selected", String(selected));
    try {
      const result = await setGitHubRepositorySelectedAction(formData);
      setMessage(result.message);
      if (!result.ok) {
        setSelections((current) => {
          const next = { ...current };
          delete next[repository.repository_id];
          return next;
        });
      } else {
        router.refresh();
      }
    } catch {
      setSelections((current) => {
        const next = { ...current };
        delete next[repository.repository_id];
        return next;
      });
      setMessage("Could not update repository scope. Please try again.");
    } finally {
      setPendingRepositories((current) => {
        const next = new Set(current);
        next.delete(repository.repository_id);
        return next;
      });
    }
  }

  async function recheckInstallation(installation: GitHubInstallationSummary) {
    if (recheckingInstallations.has(installation.id)) return;
    setMessage("");
    setRecheckingInstallations((current) => new Set(current).add(installation.id));
    const formData = new FormData();
    formData.set("installationId", installation.id);
    try {
      const result = await recheckGitHubInstallationAction(formData);
      setMessage(result.message);
      if (result.ok) router.refresh();
    } catch {
      setMessage("Could not recheck this GitHub installation. Please try again.");
    } finally {
      setRecheckingInstallations((current) => {
        const next = new Set(current);
        next.delete(installation.id);
        return next;
      });
    }
  }

  return <section className="github-shadow-panel" aria-labelledby="github-shadow-title">
    <header className="github-shadow-panel-head">
      <div>
        <p className="eyebrow">PRIVATE GITHUB APP</p>
        <h2 id="github-shadow-title">GitHub App shadow collection</h2>
        <p>Choose repositories for read-only checks. Shadow results do not change readiness, evidence, or findings.</p>
      </div>
      <a className="button primary" href="/api/github/setup">Install GitHub App</a>
    </header>

    {installations.length === 0 ? <div className="github-shadow-empty">
      <strong>No GitHub App installation connected</strong>
      <p>Install the private app to choose repositories for shadow collection.</p>
    </div> : <div className="github-installation-list">
      {installations.map((installation) => {
        const health = installationHealth(installation);
        const installationRepositories = repositories.filter((repository) => repository.installation_id === installation.id);
        const canRecheck = installation.status === "active" && installation.permissions_ok;
        const isRechecking = recheckingInstallations.has(installation.id);
        return <article className="github-installation" aria-label={`${installation.account_login} GitHub installation`} key={installation.id}>
          <div className="github-installation-head">
            <div>
              <h3>{installation.account_login}</h3>
              <p>{installation.repository_selection === "selected" ? "Selected repositories" : "All repositories"}</p>
            </div>
            <dl className="github-health-facts">
              <div><dt>Installation health</dt><dd><Pill tone={health.tone}>{health.label}</Pill></dd></div>
            </dl>
            <button
              className="button secondary"
              type="button"
              disabled={!canRecheck || isRechecking}
              onClick={() => void recheckInstallation(installation)}
            >{isRechecking ? "Rechecking…" : `Recheck ${installation.account_login}`}</button>
          </div>

          {installationRepositories.length === 0 ? <p className="github-repositories-empty">
            No repositories are available for this installation.
          </p> : <div className="github-repository-list">
            {installationRepositories.map((repository) => {
              const collection = collectionHealth(repository);
              const freshness = freshnessHealth(repository, nowIso);
              const pending = pendingRepositories.has(repository.repository_id);
              const failedChecks = repository.latest_failed_count ?? 0;
              return <article className="github-repository" aria-label={`${repository.full_name} repository`} key={repository.repository_id}>
                <div className="github-repository-scope">
                  <label>
                    <input
                      type="checkbox"
                      checked={selections[repository.repository_id] ?? repository.selected}
                      disabled={!repository.available || pending}
                      onChange={(event) => void changeRepository(repository, event.target.checked)}
                    />
                    <span>Select {repository.full_name} for shadow collection</span>
                  </label>
                  <div>
                    <a href={repository.html_url} target="_blank" rel="noreferrer">{repository.full_name}</a>
                    <p>{repositoryDetail(repository)}</p>
                    {!repository.available && <p className="field-hint">Unavailable to this GitHub App installation.</p>}
                    {repository.latest_status === "succeeded" && failedChecks > 0 && <p className="field-hint">
                      {failedChecks} {failedChecks === 1 ? "check needs" : "checks need"} attention
                    </p>}
                  </div>
                </div>
                <dl className="github-health-facts github-repository-health">
                  <div><dt>Collection health</dt><dd><Pill tone={collection.tone}>{collection.label}</Pill></dd></div>
                  <div><dt>Freshness</dt><dd><Pill tone={freshness.tone}>{freshness.label}</Pill></dd></div>
                </dl>
              </article>;
            })}
          </div>}
        </article>;
      })}
    </div>}

    <p className="github-shadow-status" role="status" aria-live="polite">{message}</p>
  </section>;
}
