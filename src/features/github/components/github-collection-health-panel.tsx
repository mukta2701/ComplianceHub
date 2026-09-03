"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Pill } from "@/components/ui";
import { recheckGitHubInstallationAction } from "@/app/app/monitoring/github-actions";
import type { GitHubInstallationSummary } from "./github-installation-panel";

export type GitHubRepositoryMonitoringSummary = {
  repository_id: string;
  installation_id: string;
  full_name: string;
  html_url: string;
  selected: boolean;
  available: boolean;
  latest_run_id: string | null;
  latest_status: "running" | "succeeded" | "partial" | "failed" | "rate_limited" | null;
  latest_failed_count: number | null;
  last_completed_collection_at: string | null;
};

type WorkspaceRole = "owner" | "admin" | "member";

function isStale(repository: GitHubRepositoryMonitoringSummary, nowIso: string): boolean {
  if (!repository.last_completed_collection_at) return false;
  const now = Date.parse(nowIso);
  const completed = Date.parse(repository.last_completed_collection_at);
  return !Number.isFinite(now) || !Number.isFinite(completed) || now >= completed + 36 * 60 * 60 * 1_000;
}

function monitoringHealth(
  repository: GitHubRepositoryMonitoringSummary,
  installation: GitHubInstallationSummary,
  nowIso: string,
): { label: string; tone: string } {
  if (!repository.available) return { label: "Repository access needs attention", tone: "amber" };
  if (installation.status !== "active" || !installation.permissions_ok) {
    return { label: "GitHub connection needs attention", tone: "amber" };
  }
  if (!repository.latest_run_id || !repository.latest_status) return { label: "Ready for first check", tone: "neutral" };
  if (repository.latest_status === "running") return { label: "Checking now", tone: "blue" };
  if (repository.latest_status === "partial") return { label: "Some checks could not be completed", tone: "amber" };
  if (repository.latest_status === "failed") return { label: "Check failed", tone: "red" };
  if (repository.latest_status === "rate_limited") return { label: "GitHub rate limit reached", tone: "red" };
  return isStale(repository, nowIso)
    ? { label: "Needs a new check", tone: "amber" }
    : { label: "Up to date", tone: "green" };
}

function formatLastChecked(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function GitHubCollectionHealthPanel({
  installations,
  repositories,
  nowIso,
  role,
}: {
  installations: GitHubInstallationSummary[];
  repositories: GitHubRepositoryMonitoringSummary[];
  nowIso: string;
  role: WorkspaceRole;
}) {
  const router = useRouter();
  const [pendingInstallations, setPendingInstallations] = useState<Set<string>>(() => new Set());
  const [messages, setMessages] = useState<Record<string, string>>({});
  const selectedRepositories = repositories.filter((repository) => repository.selected);
  const canManageConnection = role === "owner" || role === "admin";

  async function recheckInstallation(installation: GitHubInstallationSummary) {
    if (pendingInstallations.has(installation.id)) return;
    setMessages((current) => ({ ...current, [installation.id]: "" }));
    setPendingInstallations((current) => new Set(current).add(installation.id));
    const formData = new FormData();
    formData.set("installationId", installation.id);
    try {
      const result = await recheckGitHubInstallationAction(formData);
      if (result.ok) {
        setMessages((current) => ({
          ...current,
          [installation.id]: "GitHub check finished. Monitoring status is refreshed.",
        }));
        router.refresh();
      } else {
        setMessages((current) => ({ ...current, [installation.id]: "GitHub could not be checked. Please try again." }));
      }
    } catch {
      setMessages((current) => ({ ...current, [installation.id]: "GitHub could not be checked. Please try again." }));
    } finally {
      setPendingInstallations((current) => {
        const next = new Set(current);
        next.delete(installation.id);
        return next;
      });
    }
  }

  return <section className="github-shadow-panel github-collection-health-panel" aria-labelledby="github-monitoring-title">
    <header className="github-shadow-panel-head">
      <div>
        <p className="eyebrow">{installations.length > 0 ? "CONNECTED MONITORING" : "GITHUB MONITORING"}</p>
        <h2 id="github-monitoring-title">GitHub monitoring</h2>
        <p>Repository settings, check freshness, and anything that needs attention.</p>
      </div>
    </header>

    <div className="github-collection-disclosure" role="note">
      <p>GitHub access reads repository settings and metadata and never changes GitHub.</p>
      <p id="github-recheck-effects">A check can update ComplianceHub&apos;s own evidence and findings.</p>
    </div>

    {installations.length === 0 ? <div className="github-repositories-empty">
      <p>{canManageConnection
        ? "GitHub is not connected."
        : "GitHub is not connected. Ask a workspace Owner or Admin to manage the connection."}</p>
      {canManageConnection && <Link className="button secondary" href="/app/integrations">Connect GitHub</Link>}
    </div> : <div className="github-installation-list">
      {installations.map((installation) => {
        const installationRepositories = selectedRepositories.filter(
          (repository) => repository.installation_id === installation.id,
        );
        const pending = pendingInstallations.has(installation.id);
        const hasAvailableRepository = installationRepositories.some((repository) => repository.available);
        const canRunThisInstallation = installation.status === "active"
          && installation.permissions_ok
          && installation.repository_selection === "selected"
          && hasAvailableRepository;
        return <article className="github-installation" aria-label={`${installation.account_login} GitHub monitoring`} key={installation.id}>
          <div className="github-installation-head">
            <div>
              <h3>{installation.account_login}</h3>
              <p>{installationRepositories.length} monitored {installationRepositories.length === 1 ? "repository" : "repositories"}</p>
            </div>
            {role === "owner" && <button
              className="button secondary"
              type="button"
              disabled={!canRunThisInstallation || pending}
              aria-busy={pending}
              aria-describedby="github-recheck-effects"
              onClick={() => void recheckInstallation(installation)}
            >{pending ? "Checking GitHub…" : "Check GitHub now"}</button>}
          </div>
          <p className="github-shadow-status" role="status" aria-live="polite" aria-atomic="true">{messages[installation.id] ?? ""}</p>

          {installation.repository_selection === "all" && <p className="github-configuration-note" role="note">
            This connection can read all repositories allowed by GitHub. Choose specific repositories in connection settings before checking GitHub from here.
          </p>}
          {installation.status !== "active" && <p className="github-configuration-note" role="note">
            This GitHub connection is {installation.status.replace("_", " ")} and cannot be checked.
          </p>}
          {!installation.permissions_ok && <p className="github-configuration-note" role="note">
            GitHub permissions need attention before this connection can be checked.
          </p>}
          {role === "owner" && installation.repository_selection === "selected" && installationRepositories.length === 0 && <p className="field-hint">
            Select at least one available repository before checking GitHub.
          </p>}
          {role === "owner" && installation.repository_selection === "selected" && installationRepositories.length > 0 && !hasAvailableRepository && <p className="field-hint">
            No selected repositories are currently available to check.
          </p>}
          {role !== "owner" && <p className="field-hint">Only workspace Owners can check GitHub from here.</p>}

          {installationRepositories.length === 0 ? <div className="github-repositories-empty">
            <p>No repositories are selected for GitHub monitoring.</p>
            {canManageConnection && <Link className="button secondary" href="/app/integrations">Choose repositories</Link>}
          </div> : <div className="github-repository-list">
            {installationRepositories.map((repository) => {
              const health = monitoringHealth(repository, installation, nowIso);
              const failedChecks = repository.latest_failed_count ?? 0;
              const lastChecked = repository.last_completed_collection_at
                ? formatLastChecked(repository.last_completed_collection_at)
                : null;
              return <article className="github-repository" aria-label={`${repository.full_name} monitoring status`} key={repository.repository_id}>
                <div className="github-repository-health-main">
                  <a href={repository.html_url} target="_blank" rel="noreferrer" aria-label={`Open ${repository.full_name} on GitHub`}>
                    {repository.full_name}
                  </a>
                  {!repository.available && <p className="field-hint">This repository is not currently available to this GitHub connection.</p>}
                  {failedChecks > 0 && <p className="field-hint">
                    {failedChecks} {failedChecks === 1 ? "check needs" : "checks need"} attention
                  </p>}
                  {lastChecked && <p className="github-last-checked">Last checked <time dateTime={repository.last_completed_collection_at ?? undefined}>{lastChecked}</time></p>}
                </div>
                <Pill tone={health.tone}>{health.label}</Pill>
              </article>;
            })}
          </div>}
        </article>;
      })}
    </div>}
  </section>;
}
