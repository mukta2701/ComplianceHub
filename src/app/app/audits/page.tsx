import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE, summariseFindings, type AuditStatus, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import { Card, EmptyState, ModuleExplainer, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubTabs } from "@/components/sub-tabs";
import { assessAuditPreflight } from "@/features/audits/domain/preflight";
import { getModuleGuidance } from "@/features/education/domain/guidance";
import { assessScopeProfile } from "@/features/scope/domain/scope-profile";

export default async function AuditsPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const isMember = membership.role === "member";
  const today = new Date().toISOString().slice(0, 10);
  const registerResult = await supabase.from("soa_registers").select("id").eq("organisation_id", organisation.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const [{ data: audits, error: auditsError }, { data: findings, error: findingsError }, { data: soaItems, error: soaError }, { count: expiredEvidence, error: evidenceError }, { count: overdueTasks, error: tasksError }, { data: scopeProfile, error: scopeError }] = await Promise.all([
    supabase.from("audits").select("id,reference,title,status,planned_start,planned_end").eq("organisation_id", organisation.id).order("reference"),
    supabase.from("audit_findings").select("severity,status").eq("organisation_id", organisation.id),
    registerResult.data ? supabase.from("soa_items").select("applicable,status,owner_id").eq("soa_register_id", registerResult.data.id).eq("organisation_id", organisation.id) : Promise.resolve({ data: [], error: null }),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).eq("status", "expired"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).lt("due_on", today),
    supabase.from("organisation_scope_profiles").select("scope_statement,services,locations,information_types,dependencies,exclusions").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  const rows = audits ?? [];
  const openAudits = rows.filter((a) => a.status !== "closed").length;
  const f = summariseFindings((findings ?? []).map((x) => ({ severity: x.severity as FindingSeverity, status: x.status as FindingStatus })));
  const registerMissing = !registerResult.data && !registerResult.error;
  const preflightUnavailable = Boolean(registerResult.error || findingsError || soaError || evidenceError || tasksError || scopeError);
  const applicableItems = (soaItems ?? []).filter((item) => item.applicable);
  const scopeGaps = assessScopeProfile({ scopeStatement: scopeProfile?.scope_statement ?? "", services: scopeProfile?.services ?? "", locations: scopeProfile?.locations ?? "", informationTypes: scopeProfile?.information_types ?? "", dependencies: scopeProfile?.dependencies ?? "", exclusions: scopeProfile?.exclusions ?? "" }).length;
  const blockers = [...(registerMissing ? ["Create a Statement of Applicability to assess control readiness."] : []), ...assessAuditPreflight({ pendingControls: applicableItems.filter((item) => item.status === "pending").length, ownerGaps: applicableItems.filter((item) => !item.owner_id).length, expiredEvidence: expiredEvidence ?? 0, overdueTasks: overdueTasks ?? 0, openFindings: f.open, scopeGaps })];
  return <>
    <PageIntro eyebrow="AUDIT" title="Internal audits" body="Plan an audit, work the clause and control checklist, and turn findings into owned corrective actions." action={!isMember && <Link className="button primary" href="/app/audits/new"><Icon name="plus" />Plan an audit</Link>} />
    <SubTabs tabs={[{ href: "/app/audits", label: "Internal audits" }, { href: "/app/activity", label: "Audit trail" }]} />
    <ModuleExplainer guidance={getModuleGuidance("audits")} />
    <Card style={{ padding: "18px", marginBottom: "16px", borderColor: preflightUnavailable || blockers.length ? "#efe1aa" : "#cfe6d5", background: preflightUnavailable || blockers.length ? "#fffbef" : "#eef7f0" }}>
      <h2 style={{ fontSize: "15px", margin: 0 }}>Audit preflight</h2>
      {preflightUnavailable ? <p role="alert" style={{ margin: "8px 0 0", color: "#8a5a00", fontSize: "13px" }}>Preflight data is unavailable. Resolve the data-access issue before relying on this check.</p> : blockers.length ? <ul style={{ margin: "10px 0 0", paddingLeft: "18px", color: "#596273", fontSize: "13px", lineHeight: 1.6 }}>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p style={{ margin: "8px 0 0", color: "#2e6b45", fontSize: "13px" }}>No deterministic blockers found. A human still needs to review scope, evidence quality, and audit objectives.</p>}
    </Card>
    {auditsError ? (
      <Card><p role="alert" style={{ margin: 0, color: "#8a2d2d" }}>Audit records are unavailable. Resolve the data-access issue before relying on this register.</p></Card>
    ) : !rows.length ? (
      <EmptyState icon="shield" title="Plan your first audit" body="Schedule an internal audit, work the clause-and-control checklist, and turn every finding into an owned corrective action. Plan your first one to get started." primary={!isMember ? { href: "/app/audits/new", label: "Plan your first audit" } : undefined} />
    ) : (<>
    <div className="stats-grid">
      <Stat label="OPEN AUDITS" value={openAudits} detail="not yet closed" />
      <Stat label="OPEN FINDINGS" value={findingsError ? "Unavailable" : f.open} detail={findingsError ? "Finding data is unavailable." : "awaiting closure"} tone="amber" />
      <Stat label="NON-CONFORMITIES" value={findingsError ? "Unavailable" : f.openNonConformities} detail={findingsError ? "Finding data is unavailable." : "minor or major, still open"} tone="red" />
    </div>
    <Card><div className="data-table-wrap" role="region" aria-label="Internal audits table" tabIndex={0}><table>
      <thead><tr><th>Ref</th><th>Audit</th><th>Status</th><th>Window</th></tr></thead>
      <tbody>
        {rows.map((a) => <tr key={a.id}>
          <td>{a.reference}</td>
          <td><Link href={`/app/audits/${a.id}`}><b>{a.title}</b></Link></td>
          <td><Pill tone={AUDIT_STATUS_TONE[a.status as AuditStatus]}>{AUDIT_STATUS_LABEL[a.status as AuditStatus]}</Pill></td>
          <td>{a.planned_start ?? "—"} → {a.planned_end ?? "—"}</td>
        </tr>)}
      </tbody>
    </table></div></Card>
    </>)}
  </>;
}
