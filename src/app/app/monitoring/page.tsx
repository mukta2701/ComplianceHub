import Link from "next/link";
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

const SEVERITY_TONE: Record<CheckSeverity, StatusTone> = { critical: "risk", high: "risk", medium: "attention", low: "neutral" };
const SEVERITY_PILL: Record<CheckSeverity, string> = { critical: "red", high: "red", medium: "amber", low: "blue" };
const STATUS_PILL: Record<string, string> = { open: "red", acknowledged: "amber" };

type Finding = {
  id: string;
  control_ref: string;
  subject_id: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
  status: "open" | "acknowledged";
  task_id: string | null;
  detected_at: string;
};
type Source = { id: string; provider: string; label: string; created_at: string };

function providerLabel(provider: string): string {
  return provider.length > 0 ? provider[0].toUpperCase() + provider.slice(1) : "System";
}

export default async function MonitoringPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") {
    return <MemberMonitoring data={await loadMemberMonitoring(supabase, organisation.id)} />;
  }

  const canManageMonitoring = hasCapability(membership.role, "manage_monitoring");
  const [findingResult, sourceResult] = await Promise.all([
    supabase.from("monitoring_findings")
      .select("id,control_ref,subject_id,severity,title,detail,status,task_id,detected_at")
      .eq("organisation_id", organisation.id)
      .in("status", ["open", "acknowledged"])
      .order("detected_at", { ascending: false })
      .limit(100),
    // No provider configuration or token is needed in the monitoring view.
    supabase.from("monitor_sources")
      .select("id,provider,label,created_at")
      .eq("organisation_id", organisation.id)
      .eq("enabled", true)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (findingResult.error || sourceResult.error) throw new Error("Could not load monitoring");

  // Keep the rendered set active-only even if a non-PostgREST test adapter or
  // stale cache ever returns a row outside the requested status filter.
  const findings = ((findingResult.data ?? []) as Finding[]).filter(
    (finding) => finding.status === "open" || finding.status === "acknowledged",
  );
  const sources = (sourceResult.data ?? []) as Source[];
  const highOrCritical = findings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length;

  return <>
    <PageIntro
      eyebrow="MONITORING"
      title="Continuous monitoring"
      body="Connected systems and the active findings that need attention. Connection and alert setup lives in Settings."
    />

    <Card className="monitor-banner" style={{ marginBottom: "16px" }}>
      <span className={`monitor-dot ${findings.length === 0 ? "ok" : "watch"}`} aria-hidden="true" />
      <div style={{ flex: 1 }}>
        <strong>{findings.length === 0 ? "No active findings" : `${findings.length} active finding${findings.length === 1 ? "" : "s"}`}</strong>
        <p>{highOrCritical} high or critical · {sources.length} enabled system{sources.length === 1 ? "" : "s"} monitored</p>
      </div>
      <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {shouldShowRunMonitoring(membership.role, sources.length) && <form action={runMonitoringNowAction}><button className="button">Run checks now</button></form>}
        <Link className="button secondary" href="/app/integrations">Manage connections and alerts</Link>
      </span>
    </Card>

    <Card style={{ marginBottom: "16px" }}>
      <div className="card-head"><div><h3>Connected systems</h3><p>Enabled systems included in monitoring</p></div></div>
      {sources.length > 0 ? <ul className="monitor-list">
        {sources.map((source) => <li key={source.id}>
          <span className="ml-body"><strong>{source.label || providerLabel(source.provider)}</strong><span className="ml-meta">
            <Pill tone="neutral">{providerLabel(source.provider)}</Pill>
            <StatusLabel tone="confirmed">Connected {new Date(source.created_at).toLocaleDateString("en-GB")}</StatusLabel>
          </span></span>
        </li>)}
      </ul> : <p className="empty-note">No enabled systems are currently being monitored. An Owner or Admin can manage connections in Settings.</p>}
    </Card>

    <Card>
      <div className="card-head"><div><h3>Active findings</h3><p>Current violations and drift, newest first</p></div></div>
      {findings.length > 0 ? <ul className="finding-list">
        {findings.map((finding) => <li key={finding.id} data-status={finding.status}>
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
          {canManageMonitoring && <div className="finding-actions">
            {finding.status === "open" && <form action={acknowledgeFindingAction}><input type="hidden" name="id" value={finding.id} /><button className="button secondary">Acknowledge</button></form>}
            {!finding.task_id && <form action={raiseTaskFromFindingAction}><input type="hidden" name="id" value={finding.id} /><button className="button secondary">Raise task</button></form>}
            <form action={resolveFindingAction}><input type="hidden" name="id" value={finding.id} /><button className="button secondary">Resolve</button></form>
          </div>}
        </li>)}
      </ul> : <p className="empty-note">No active findings are currently visible.</p>}
    </Card>
  </>;
}
