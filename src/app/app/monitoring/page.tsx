import Link from "next/link";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import type { CheckSeverity } from "@/features/monitoring/domain/monitor-provider";
import { Card, PageIntro, Pill } from "@/components/ui";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import {
  acknowledgeFindingAction,
  raiseTaskFromFindingAction,
  resolveFindingAction,
  runMonitoringNowAction,
} from "./actions";
import { shouldShowRunMonitoring } from "./monitoring-access";
import { hasCapability } from "@/features/organisations/domain/access";
import { loadMemberMonitoring } from "@/features/monitoring/application/load-member-monitoring";
import { MemberMonitoring } from "@/features/monitoring/components/member-monitoring";
import {
  ACTIVE_MONITORING_FINDING_STATUSES,
  type ActiveMonitoringFindingStatus,
} from "@/features/monitoring/domain/finding-status";
import {
  loadOfficialGitHubFindingProvenance,
  parseOfficialRecordSelection,
} from "@/features/github/application/github-record-provenance";
import { OfficialGitHubFindingCard } from "@/features/github/components/github-record-provenance";
import {
  loadGitHubComplianceControlRoom,
  type GitHubComplianceControlRoom,
} from "@/features/github/application/github-compliance-control-room";
import { loadGitHubMappingReview, type GitHubMappingReview } from "@/features/github/application/github-mapping-review";
import { GitHubComplianceControlRoomPanel } from "@/features/github/components/github-compliance-control-room";
import type {
  GitHubInstallationSummary,
} from "@/features/github/components/github-installation-panel";
import {
  GitHubCollectionHealthPanel,
  type GitHubRepositoryMonitoringSummary,
} from "@/features/github/components/github-collection-health-panel";

const SEVERITY_TONE: Record<CheckSeverity, StatusTone> = { critical: "risk", high: "risk", medium: "attention", low: "neutral" };
const SEVERITY_PILL: Record<CheckSeverity, string> = { critical: "red", high: "red", medium: "amber", low: "blue" };
const STATUS_PILL: Record<ActiveMonitoringFindingStatus, string> = {
  open: "red",
  acknowledged: "amber",
  in_progress: "amber",
  exception_requested: "amber",
  risk_accepted: "blue",
};

const findingRowsSchema = z.array(z.object({
  id: z.uuid(),
  control_ref: z.string().max(40),
  subject_id: z.string().min(1).max(200),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1).max(300),
  detail: z.string().max(4_000),
  status: z.enum([...ACTIVE_MONITORING_FINDING_STATUSES, "resolved"]),
  task_id: z.uuid().nullable(),
  detected_at: z.string().datetime({ offset: true }),
  finding_origin: z.enum(["legacy", "github"]),
}).strict()).max(100);
const sourceRowsSchema = z.array(z.object({
  id: z.uuid(), provider: z.string().min(1).max(40), label: z.string().max(160),
  created_at: z.string().datetime({ offset: true }),
}).strict()).max(100);
type ParsedFinding = z.infer<typeof findingRowsSchema>[number];

function isActiveFinding(
  finding: ParsedFinding,
): finding is ParsedFinding & { status: ActiveMonitoringFindingStatus } {
  return finding.status !== "resolved";
}

function providerLabel(provider: string): string {
  return provider.length > 0 ? provider[0].toUpperCase() + provider.slice(1) : "System";
}

function unhealthyGitHubRepositoryIds(
  room: GitHubComplianceControlRoom,
  installations: GitHubInstallationSummary[],
  repositories: GitHubRepositoryMonitoringSummary[],
): string[] {
  return room.repositories
    .filter((repository) => {
      const summary = repositories.find((candidate) => candidate.repository_id === repository.id);
      const installation = installations.find((candidate) => candidate.id === summary?.installation_id);
      return !repository.available || !installation || installation.status !== "active" || installation.permissions_ok !== true;
    })
    .map((repository) => repository.id);
}

function GitHubMonitoringSection({
  role,
  installations,
  repositories,
  nowIso,
}: {
  role: "owner" | "admin" | "member";
  installations: GitHubInstallationSummary[];
  repositories: GitHubRepositoryMonitoringSummary[];
  nowIso: string;
}) {
  return <section className="monitor-github-section" aria-label="GitHub repository monitoring">
    <GitHubCollectionHealthPanel
      installations={installations}
      repositories={repositories}
      nowIso={nowIso}
      role={role}
    />
  </section>;
}

function GitHubTechnicalReview({
  room,
  review,
  role,
  unhealthyRepositoryIds,
}: {
  room: GitHubComplianceControlRoom;
  review: GitHubMappingReview;
  role: "owner" | "admin" | "member";
  unhealthyRepositoryIds: string[];
}) {
  return <details className="monitor-technical-review">
    <summary>Technical review and recovery</summary>
    <p>Review how repository checks become governed ISO evidence or findings, and use authorised recovery controls.</p>
    <GitHubComplianceControlRoomPanel
      room={room}
      review={review}
      role={role}
      unhealthyRepositoryIds={unhealthyRepositoryIds}
    />
  </details>;
}

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ finding?: string | string[]; githubPage?: string | string[] }>;
} = { searchParams: Promise.resolve({}) }) {
  const { supabase, organisation, membership } = await requireAppContext();
  const params = await searchParams;
  const requestedFinding = parseOfficialRecordSelection(params.finding);
  const requestedPage = Array.isArray(params.githubPage) ? params.githubPage[0] : params.githubPage;
  const parsedPage = requestedPage && /^[1-9][0-9]{0,2}$/.test(requestedPage) ? Number(requestedPage) : 1;
  const repositoryOffset = Math.min((parsedPage - 1) * 20, 10_000);
  if (membership.role === "member") {
    const [data, installationResult, repositorySummaryResult, controlRoom, mappingReview] = await Promise.all([
      loadMemberMonitoring(supabase, organisation.id),
      supabase.from("github_installations")
        .select("id,account_login,status,repository_selection,permissions_ok")
        .eq("organisation_id", organisation.id)
        .order("updated_at", { ascending: false }),
      supabase.from("github_repository_monitoring_summaries")
        .select("repository_id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available,latest_run_id,latest_status,latest_failed_count,last_completed_collection_at")
        .eq("organisation_id", organisation.id)
        .order("full_name", { ascending: true }),
      loadGitHubComplianceControlRoom(supabase, { organisationId: organisation.id, offset: repositoryOffset, limit: 20 }),
      loadGitHubMappingReview(supabase, organisation.id),
    ]);
    if (installationResult.error || repositorySummaryResult.error) throw new Error("Could not load monitoring");
    const selectedFinding = requestedFinding && data.officialGitHubFindings.some((record) => record.findingId === requestedFinding)
      ? requestedFinding
      : null;
    const installations = (installationResult.data ?? []) as GitHubInstallationSummary[];
    const repositories = (repositorySummaryResult.data ?? []) as GitHubRepositoryMonitoringSummary[];
    const hasActiveGitHubInstallation = installations.some(
      (installation) => installation.status === "active",
    );
    return <MemberMonitoring
      data={data}
      selectedFinding={selectedFinding}
      hasActiveGitHubInstallation={hasActiveGitHubInstallation}
      githubMonitoring={<GitHubMonitoringSection
        role={membership.role}
        installations={installations}
        repositories={repositories}
        nowIso={new Date().toISOString()}
      />}
      githubTechnicalReview={<GitHubTechnicalReview
        room={controlRoom}
        review={mappingReview}
        role={membership.role}
        unhealthyRepositoryIds={unhealthyGitHubRepositoryIds(controlRoom, installations, repositories)}
      />}
    />;
  }

  const canManageMonitoringFindings = hasCapability(membership.role, "manage_monitoring_findings");
  const [findingResult, sourceResult, installationResult, repositorySummaryResult, controlRoom, mappingReview] = await Promise.all([
    supabase.from("monitoring_findings")
      .select("id,control_ref,subject_id,severity,title,detail,status,task_id,detected_at,finding_origin")
      .eq("organisation_id", organisation.id)
      .in("status", [...ACTIVE_MONITORING_FINDING_STATUSES])
      .order("detected_at", { ascending: false })
      .limit(100),
    // No provider configuration or token is needed in the monitoring view.
    supabase.from("monitor_sources")
      .select("id,provider,label,created_at")
      .eq("organisation_id", organisation.id)
      .eq("enabled", true)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("github_installations")
      .select("id,account_login,status,repository_selection,permissions_ok")
      .eq("organisation_id", organisation.id)
      .order("updated_at", { ascending: false }),
    supabase.from("github_repository_monitoring_summaries")
      .select("repository_id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available,latest_run_id,latest_status,latest_failed_count,last_completed_collection_at")
      .eq("organisation_id", organisation.id)
      .order("full_name", { ascending: true }),
    loadGitHubComplianceControlRoom(supabase, { organisationId: organisation.id, offset: repositoryOffset, limit: 20 }),
    loadGitHubMappingReview(supabase, organisation.id),
  ]);
  if (findingResult.error || sourceResult.error || installationResult.error || repositorySummaryResult.error) throw new Error("Could not load monitoring");

  // Keep the rendered set active-only even if a non-PostgREST test adapter or
  // stale cache ever returns a row outside the requested status filter.
  const parsedFindings = findingRowsSchema.safeParse(findingResult.data ?? []);
  const parsedSources = sourceRowsSchema.safeParse(sourceResult.data ?? []);
  if (!parsedFindings.success || !parsedSources.success) throw new Error("Could not load monitoring");
  const findings = parsedFindings.data.filter(isActiveFinding);
  const githubTargets = findings
    .filter((finding) => finding.finding_origin === "github")
    .map((finding) => ({ findingId: finding.id, status: finding.status }));
  const officialGitHubFindings = await loadOfficialGitHubFindingProvenance(
    supabase,
    organisation.id,
    githubTargets,
  );
  if (officialGitHubFindings.length !== githubTargets.length
    || officialGitHubFindings.some((record) => !githubTargets.some((target) => target.findingId === record.findingId))) {
    throw new Error("Could not load monitoring");
  }
  const officialByFinding = new Map(officialGitHubFindings.map((record) => [record.findingId, record]));
  const selectedFinding = requestedFinding && officialByFinding.has(requestedFinding) ? requestedFinding : null;
  const sources = parsedSources.data;
  const installations = (installationResult.data ?? []) as GitHubInstallationSummary[];
  const repositories = (repositorySummaryResult.data ?? []) as GitHubRepositoryMonitoringSummary[];
  const hasActiveGitHubInstallation = installations.some(
    (installation) => installation.status === "active",
  );
  const otherSources = sources.filter((source) => source.provider !== "github");
  const monitoredSystemCount = otherSources.length + (hasActiveGitHubInstallation ? 1 : 0);
  const highOrCritical = findings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length;

  return <div className="monitoring-page">
    <PageIntro
      eyebrow="MONITORING"
      title="Continuous monitoring"
      body="Connected systems and the active findings that need attention. Connection and alert setup lives in Settings."
    />

    <Card className="monitor-banner" style={{ marginBottom: "16px" }}>
      <span className={`monitor-dot ${findings.length === 0 ? "neutral" : "watch"}`} aria-hidden="true" />
      <div style={{ flex: 1 }}>
        <strong>{findings.length === 0 ? "No recorded active findings" : `${findings.length} active finding${findings.length === 1 ? "" : "s"}`}</strong>
        <p>{highOrCritical} high or critical · {monitoredSystemCount} system{monitoredSystemCount === 1 ? "" : "s"} monitored{findings.length === 0 ? ". Monitoring status is not yet confirmed." : ""}</p>
      </div>
      <span className="monitor-banner-actions">
        {shouldShowRunMonitoring(membership.role, otherSources.length) && <form action={runMonitoringNowAction}><button className="button">Run checks now</button></form>}
        <Link className="button secondary" href="/app/integrations">Manage connections and alerts</Link>
      </span>
    </Card>

    <GitHubMonitoringSection
      role={membership.role}
      installations={installations}
      repositories={repositories}
      nowIso={new Date().toISOString()}
    />

    <Card className="monitor-findings-card">
      <div className="card-head"><div><h3>Active findings</h3><p>Current violations and drift, newest first</p></div></div>
      {findings.length > 0 ? <ul className="finding-list">
        {findings.map((finding) => {
          const official = officialByFinding.get(finding.id);
          if (finding.finding_origin === "github") {
            if (!official) throw new Error("Could not load monitoring");
            return <li key={finding.id} data-status={finding.status}>
            <OfficialGitHubFindingCard
              record={official}
              status={finding.status}
              taskId={finding.task_id}
              role={membership.role}
              selected={selectedFinding === finding.id}
            />
          </li>;
          }
          return <li key={finding.id} data-status={finding.status}>
          <div className="finding-head">
            <Pill tone={SEVERITY_PILL[finding.severity]}>{finding.severity}</Pill>
            <strong>{finding.title}</strong>
            <Pill tone={STATUS_PILL[finding.status]}>{finding.status}</Pill>
          </div>
          <p className="finding-detail">{finding.detail}</p>
          <div className="finding-meta">
            <StatusLabel tone={SEVERITY_TONE[finding.severity]}>{finding.control_ref}</StatusLabel>
            <span>{finding.subject_id}</span>
            <span>Detected {new Date(finding.detected_at).toLocaleString("en-GB")}</span>
            {finding.task_id && <Link href={`/app/tasks/${finding.task_id}`}>Remediation task →</Link>}
          </div>
          {canManageMonitoringFindings && <div className="finding-actions">
            {finding.status === "open" && <form action={acknowledgeFindingAction}><input type="hidden" name="id" value={finding.id} /><button className="button secondary">Acknowledge</button></form>}
            {!finding.task_id && <form action={raiseTaskFromFindingAction}><input type="hidden" name="id" value={finding.id} /><button className="button secondary">Raise task</button></form>}
            <form action={resolveFindingAction}><input type="hidden" name="id" value={finding.id} /><button className="button secondary">Resolve</button></form>
          </div>}
        </li>;
        })}
      </ul> : <p className="empty-note">No active findings are currently visible.</p>}
    </Card>

    {otherSources.length > 0 && <Card className="monitor-other-systems-card">
      <div className="card-head"><div><h3>Other monitored systems</h3><p>Other enabled systems included in monitoring</p></div></div>
      <ul className="monitor-list">
        {otherSources.map((source) => <li key={source.id}>
          <span className="ml-body"><strong>{source.label || providerLabel(source.provider)}</strong><span className="ml-meta">
            <Pill tone="neutral">{providerLabel(source.provider)}</Pill>
            <StatusLabel tone="confirmed">Connected {new Date(source.created_at).toLocaleDateString("en-GB")}</StatusLabel>
          </span></span>
        </li>)}
      </ul>
    </Card>}

    <GitHubTechnicalReview
      room={controlRoom}
      review={mappingReview}
      role={membership.role}
      unhealthyRepositoryIds={unhealthyGitHubRepositoryIds(controlRoom, installations, repositories)}
    />
  </div>;
}
