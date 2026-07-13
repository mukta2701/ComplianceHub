import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { resolveMonitorProvider } from "@/features/monitoring/application/monitor-registry";
import { summariseChecks } from "@/features/monitoring/domain/detect";
import type { MonitorProviderKind, CheckSeverity } from "@/features/monitoring/domain/monitor-provider";
import { Card, PageIntro, Pill } from "@/components/ui";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import {
  addAlertChannelAction, addMonitorSourceAction, acknowledgeFindingAction, raiseTaskFromFindingAction,
  resolveFindingAction, revokeAlertChannelAction, revokeMonitorSourceAction, runMonitoringNowAction,
} from "./actions";
import { shouldShowRunMonitoring } from "./monitoring-access";

const SEVERITY_TONE: Record<CheckSeverity, StatusTone> = { critical: "risk", high: "risk", medium: "attention", low: "neutral" };
const SEVERITY_PILL: Record<CheckSeverity, string> = { critical: "red", high: "red", medium: "amber", low: "blue" };
const STATUS_PILL: Record<string, string> = { open: "red", acknowledged: "amber", resolved: "green" };

type Finding = {
  id: string; check_id: string; control_ref: string; subject_type: string; subject_id: string;
  severity: CheckSeverity; title: string; detail: string; status: string; task_id: string | null;
  detected_at: string; resolved_at: string | null;
};
type Source = { id: string; provider: string; label: string; config: { owner?: string; repo?: string } };
type Channel = { id: string; type: string; label: string; min_severity: string };

export default async function MonitoringPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const isOwner = membership.role === "owner";
  const today = new Date().toISOString().slice(0, 10);

  const [findings, sources, channels] = await Promise.all([
    supabase.from("monitoring_findings").select("id,check_id,control_ref,subject_type,subject_id,severity,title,detail,status,task_id,detected_at,resolved_at").eq("organisation_id", organisation.id).order("detected_at", { ascending: false }).limit(100).then((r) => (r.data ?? []) as Finding[]),
    supabase.from("monitor_sources").select("id,provider,label,config").eq("organisation_id", organisation.id).is("revoked_at", null).order("created_at", { ascending: false }).then((r) => (r.data ?? []) as Source[]),
    // config (the webhook) is deliberately NOT selected — it is a credential.
    supabase.from("alert_channels").select("id,type,label,min_severity").eq("organisation_id", organisation.id).is("revoked_at", null).order("created_at", { ascending: false }).then((r) => (r.data ?? []) as Channel[]),
  ]);

  // Live posture per connected source (the fake provider is deterministic + no
  // network; the real GitHub adapter is Phase 2, gated by MONITORING_LIVE).
  const sourceHealth = await Promise.all(sources.map(async (s) => {
    const checks = await resolveMonitorProvider(s.provider as MonitorProviderKind).runChecks({
      id: s.id, provider: s.provider as MonitorProviderKind, config: s.config ?? {}, accessToken: "",
    });
    return { source: s, summary: summariseChecks(checks) };
  }));

  const openFindings = findings.filter((f) => f.status === "open" || f.status === "acknowledged");
  const criticalOpen = openFindings.filter((f) => f.severity === "critical" || f.severity === "high").length;

  return <>
    <PageIntro
      eyebrow="MONITORING"
      title="Continuous monitoring"
      body="ComplianceHub watches the systems where your work happens — it connects to a tool like GitHub, runs compliance checks continuously, and the moment it detects a policy violation or rising risk it raises a finding, alerts you in-app, and notifies your team in Slack."
    />

    <Card className="monitor-banner" style={{ marginBottom: "16px" }}>
      <span className={`monitor-dot ${sources.length === 0 ? "watch" : openFindings.length === 0 ? "ok" : "watch"}`} aria-hidden="true" />
      <div style={{ flex: 1 }}>
        <strong>
          {sources.length === 0 ? "Connect a system to start watching"
            : openFindings.length === 0 ? "All watched systems are compliant"
            : `${openFindings.length} open finding${openFindings.length === 1 ? "" : "s"}${criticalOpen > 0 ? ` · ${criticalOpen} high or critical` : ""}`}
        </strong>
        <p>
          {sources.length === 0
            ? "Add a GitHub source below and ComplianceHub will run continuous checks against it — branch protection, org 2FA, admin changes — and alert you the moment something drifts."
            : `Watching ${sources.length} source${sources.length === 1 ? "" : "s"}. The hourly run checks posture, raises findings, and alerts in-app + Slack. Live as of ${today}.`}
        </p>
      </div>
      {shouldShowRunMonitoring(membership.role, sources.length) && <form action={runMonitoringNowAction}><button className="button">Run checks now</button></form>}
    </Card>

    <Card style={{ marginBottom: "16px" }}>
      <div className="card-head"><div><h3>Connected systems</h3><p>Workplace tools ComplianceHub watches continuously</p></div><Link href="/app/integrations">All connections</Link></div>
      {sourceHealth.length > 0
        ? <ul className="monitor-list">
            {sourceHealth.map(({ source, summary }) => <li key={source.id}>
              <span className="ml-body" style={{ width: "100%" }}>
                <strong>{source.label || `${source.config?.owner}/${source.config?.repo}`}</strong>
                <span className="ml-meta">
                  <Pill tone="neutral">GitHub</Pill>
                  <StatusLabel tone={summary.failing > 0 ? (summary.worstSeverity === "critical" || summary.worstSeverity === "high" ? "risk" : "attention") : "confirmed"}>
                    {summary.passing}/{summary.total} checks passing{summary.failing > 0 ? ` · ${summary.failing} failing` : ""}
                  </StatusLabel>
                </span>
              </span>
              {isOwner && <form action={revokeMonitorSourceAction}><input type="hidden" name="id" value={source.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Disconnect</button></form>}
            </li>)}
          </ul>
        : <p className="empty-note">No systems connected yet. Connect one below to begin continuous monitoring.</p>}
      {isOwner && <form action={addMonitorSourceAction} className="monitor-connect-form">
        <div className="mc-field"><label htmlFor="ms-owner">GitHub owner</label><input id="ms-owner" name="owner" placeholder="acme" required /></div>
        <div className="mc-field"><label htmlFor="ms-repo">Repository</label><input id="ms-repo" name="repo" placeholder="isms" required /></div>
        <div className="mc-field"><label htmlFor="ms-label">Label (optional)</label><input id="ms-label" name="label" placeholder="Production ISMS repo" /></div>
        <button className="button">Connect source</button>
        <p className="field-hint">Sandbox mode — no OAuth needed. A real access token + GitHub OAuth is the go-live step.</p>
      </form>}
    </Card>

    <Card style={{ marginBottom: "16px" }}>
      <div className="card-head"><div><h3>Active findings</h3><p>Detected violations and drift, newest first</p></div></div>
      {findings.length > 0
        ? <ul className="finding-list">
            {findings.map((f) => <li key={f.id} data-status={f.status}>
              <div className="finding-head">
                <Pill tone={SEVERITY_PILL[f.severity]}>{f.severity}</Pill>
                <strong>{f.title}</strong>
                <Pill tone={STATUS_PILL[f.status] ?? "blue"}>{f.status}</Pill>
              </div>
              <p className="finding-detail">{f.detail}</p>
              <div className="finding-meta">
                <StatusLabel tone={SEVERITY_TONE[f.severity]}>{f.control_ref}</StatusLabel>
                <span>{f.subject_id}</span>
                <span>Detected {new Date(f.detected_at).toLocaleString("en-GB")}</span>
                {f.task_id && <Link href={`/app/tasks/${f.task_id}`}>Remediation task →</Link>}
              </div>
              {isOwner && f.status !== "resolved" && <div className="finding-actions">
                {f.status === "open" && <form action={acknowledgeFindingAction}><input type="hidden" name="id" value={f.id} /><button className="button secondary">Acknowledge</button></form>}
                {!f.task_id && <form action={raiseTaskFromFindingAction}><input type="hidden" name="id" value={f.id} /><button className="button secondary">Raise task</button></form>}
                <form action={resolveFindingAction}><input type="hidden" name="id" value={f.id} /><button className="button secondary">Resolve</button></form>
              </div>}
            </li>)}
          </ul>
        : <p className="empty-note">{sources.length === 0 ? "Connect a system to start detecting findings." : "No findings — every check on your connected systems is passing. Run checks now or wait for the hourly sweep."}</p>}
    </Card>

    <Card>
      <div className="card-head"><div><h3>Alert channels</h3><p>Where ComplianceHub notifies your team when a finding is raised</p></div></div>
      <ul className="monitor-list">
        <li>
          <span className="ml-body"><strong>In-app pop-up &amp; notifications</strong><span className="ml-meta"><Pill tone="green">Always on</Pill><StatusLabel tone="confirmed">Every finding alerts owners in the app</StatusLabel></span></span>
        </li>
        {channels.map((c) => <li key={c.id}>
          <span className="ml-body"><strong>{c.label}</strong><span className="ml-meta"><Pill tone="neutral">Slack</Pill><StatusLabel tone="neutral">Alerts at {c.min_severity} and above</StatusLabel></span></span>
          {isOwner && <form action={revokeAlertChannelAction}><input type="hidden" name="id" value={c.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Remove</button></form>}
        </li>)}
      </ul>
      {isOwner && <form action={addAlertChannelAction} className="monitor-connect-form">
        <div className="mc-field" style={{ flex: "2 1 320px" }}><label htmlFor="ac-url">Slack incoming-webhook URL</label><input id="ac-url" name="webhookUrl" type="url" placeholder="https://hooks.slack.com/services/…" required /></div>
        <div className="mc-field"><label htmlFor="ac-sev">Alert at</label>
          <select id="ac-sev" name="minSeverity" defaultValue="high">
            <option value="low">Low and above</option>
            <option value="medium">Medium and above</option>
            <option value="high">High and above</option>
            <option value="critical">Critical only</option>
          </select>
        </div>
        <div className="mc-field"><label htmlFor="ac-label">Label (optional)</label><input id="ac-label" name="label" placeholder="#compliance-alerts" /></div>
        <button className="button">Add Slack channel</button>
        <p className="field-hint">Create an incoming webhook in Slack and paste its URL. It is stored as a credential and never shown again.</p>
      </form>}
    </Card>
  </>;
}
