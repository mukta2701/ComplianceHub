import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE, summariseFindings, type AuditStatus, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import { Card, EmptyState, ModuleExplainer, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubTabs } from "@/components/sub-tabs";
import { assessAuditPreflight } from "@/features/audits/domain/preflight";
import { getModuleGuidance } from "@/features/education/domain/guidance";
import { assessScopeProfile } from "@/features/scope/domain/scope-profile";
import styles from "./audit-workspace.module.css";

type AuditRow = { id:string; reference:string; title:string; status:string; planned_start:string|null; planned_end:string|null };

function displayDate(value:string|null) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle:"medium", timeZone:"UTC" }).format(new Date(value)) : "Not scheduled";
}

function AuditJourney() {
  return <nav className={styles.journey} aria-label="Proof to audit journey">
    <Link href="/app/evidence"><strong>1</strong>Evidence collected</Link>
    <Link href="/app/monitoring"><strong>2</strong>Systems watched</Link>
    <Link href="/app/audits" aria-current="page"><strong>3</strong>Controls audited</Link>
  </nav>;
}

function Summary({ icon,label,value,detail,tone }: { icon:string;label:string;value:number|string;detail:string;tone?:string }) {
  return <Card className={styles.summaryCard}><span className={styles.summaryIcon} data-tone={tone}><Icon name={icon} /></span><span><small className={styles.summaryLabel}>{label}</small><strong className={styles.summaryValue}>{value}</strong><small className={styles.summaryDetail}>{detail}</small></span></Card>;
}

function AuditTableRow({ audit }: { audit:AuditRow }) {
  const status = audit.status as AuditStatus;
  return <tr><td><strong>{audit.reference}</strong></td><td className={styles.auditCell}><strong><Link href={`/app/audits/${audit.id}`}>{audit.title}</Link></strong><small>Open the checklist, evidence and findings</small></td><td><Pill tone={AUDIT_STATUS_TONE[status]}>{AUDIT_STATUS_LABEL[status]}</Pill></td><td className={styles.window}>{displayDate(audit.planned_start)} → {displayDate(audit.planned_end)}</td></tr>;
}

function AuditCard({ audit }: { audit:AuditRow }) {
  const status = audit.status as AuditStatus;
  return <li className={styles.mobileCard}><div className={styles.mobileTop}><span className={styles.mobileTitle}><small>{audit.reference}</small><strong><Link href={`/app/audits/${audit.id}`}>{audit.title}</Link></strong></span><Pill tone={AUDIT_STATUS_TONE[status]}>{AUDIT_STATUS_LABEL[status]}</Pill></div><dl className={styles.mobileMeta}><div><dt>Planned start</dt><dd>{displayDate(audit.planned_start)}</dd></div><div><dt>Planned end</dt><dd>{displayDate(audit.planned_end)}</dd></div></dl></li>;
}

export default async function AuditsPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const isMember = membership.role === "member";
  const today = new Date().toISOString().slice(0, 10);
  const registerResult = await supabase.from("soa_registers").select("id").eq("organisation_id", organisation.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const [{ data: audits, error: auditsError }, { data: findings, error: findingsError }, { data: soaItems, error: soaError }, { count: expiredEvidence, error: evidenceError }, { count: overdueTasks, error: tasksError }, { data: scopeProfile, error: scopeError }] = await Promise.all([
    supabase.from("audits").select("id,reference,title,status,planned_start,planned_end").eq("organisation_id", organisation.id).order("reference"),
    supabase.from("audit_findings").select("severity,status").eq("organisation_id", organisation.id),
    registerResult.data ? supabase.from("soa_items").select("applicable,status,owner_id").eq("soa_register_id", registerResult.data.id).eq("organisation_id", organisation.id) : Promise.resolve({ data: [], error: null }),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).or(`status.eq.expired,and(status.in.(current,expiring),valid_until.lt.${today})`),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).lt("due_on", today),
    supabase.from("organisation_scope_profiles").select("scope_statement,services,locations,information_types,dependencies,exclusions").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  const rows = (audits ?? []) as AuditRow[];
  const openAudits = rows.filter((audit) => audit.status !== "closed").length;
  const activeAudits = rows.filter((audit) => audit.status === "in_progress" || audit.status === "reporting").length;
  const findingSummary = summariseFindings((findings ?? []).map((finding) => ({ severity: finding.severity as FindingSeverity, status: finding.status as FindingStatus })));
  const registerMissing = !registerResult.data && !registerResult.error;
  const preflightUnavailable = Boolean(registerResult.error || findingsError || soaError || evidenceError || tasksError || scopeError);
  const applicableItems = (soaItems ?? []).filter((item) => item.applicable);
  const scopeGaps = assessScopeProfile({ scopeStatement: scopeProfile?.scope_statement ?? "", services: scopeProfile?.services ?? "", locations: scopeProfile?.locations ?? "", informationTypes: scopeProfile?.information_types ?? "", dependencies: scopeProfile?.dependencies ?? "", exclusions: scopeProfile?.exclusions ?? "" }).length;
  const blockers = [...(registerMissing ? ["Create a Statement of Applicability to assess control readiness."] : []), ...assessAuditPreflight({ pendingControls: applicableItems.filter((item) => item.status === "pending").length, ownerGaps: applicableItems.filter((item) => !item.owner_id).length, expiredEvidence: expiredEvidence ?? 0, overdueTasks: overdueTasks ?? 0, openFindings: findingSummary.open, scopeGaps })];

  return <div className={styles.page}>
    <PageIntro eyebrow="AUDIT" title="Internal audits" body="Plan independent checks, work the control checklist, and turn findings into owned corrective action." action={!isMember && <Link className="button primary" href="/app/audits/new"><Icon name="plus" />Plan an audit</Link>} />
    <AuditJourney />
    <SubTabs tabs={[{ href: "/app/audits", label: "Internal audits" }, { href: "/app/activity", label: "Audit trail" }]} />
    <details className="section-guide"><summary>How internal audits work</summary><ModuleExplainer guidance={getModuleGuidance("audits")} /></details>
    <Card className={styles.preflight} data-clear={!preflightUnavailable && blockers.length === 0}>
      <div><h2>Audit preflight</h2>{preflightUnavailable ? <p role="alert">Preflight data is unavailable. Resolve the data-access issue before relying on this check.</p> : blockers.length ? <><p>Resolve these known programme gaps before relying on an audit-readiness decision.</p><ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></> : <p>No deterministic blockers found. A human still needs to review scope, evidence quality and audit objectives.</p>}</div>
      <span className={styles.preflightStatus}><i className={styles.statusDot} />{preflightUnavailable ? "Status unavailable" : blockers.length ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}` : "Ready for human review"}</span>
    </Card>
    {auditsError ? <Card><p role="alert">Audit records are unavailable. Resolve the data-access issue before relying on this register.</p></Card> : !rows.length ? <EmptyState icon="shield" title="Plan your first audit" body="Schedule an internal audit, work the clause-and-control checklist, and turn every finding into an owned corrective action." primary={!isMember ? { href: "/app/audits/new", label: "Plan your first audit" } : undefined} /> : <>
      <div className={styles.summaryGrid} aria-label="Audit register summary">
        <Summary icon="clipboard" label="Open audits" value={openAudits} detail="not yet closed" />
        <Summary icon="activity" label="Active now" value={activeAudits} detail="in progress or reporting" tone="success" />
        <Summary icon="alert" label="Open findings" value={findingsError ? "Unavailable" : findingSummary.open} detail={findingsError ? "Finding data is unavailable" : "awaiting closure"} tone="attention" />
        <Summary icon="shield" label="Non-conformities" value={findingsError ? "Unavailable" : findingSummary.openNonConformities} detail={findingsError ? "Finding data is unavailable" : "minor or major, still open"} tone="risk" />
      </div>
      <Card className={styles.registerCard}>
        <div className={styles.sectionHeader}><div><h2>Audit register</h2><p>Each audit keeps its checklist results, evidence and formal findings together.</p></div><span className={styles.registerCount}>{rows.length} audit{rows.length === 1 ? "" : "s"}</span></div>
        <div className={styles.desktopTable}><div className="data-table-wrap" role="region" aria-label="Internal audits table" tabIndex={0}><table><thead><tr><th>Reference</th><th>Audit</th><th>Status</th><th>Window</th></tr></thead><tbody>{rows.map((audit) => <AuditTableRow key={audit.id} audit={audit} />)}</tbody></table></div></div>
        <ul className={styles.mobileList} aria-label="Internal audit cards">{rows.map((audit) => <AuditCard key={audit.id} audit={audit} />)}</ul>
      </Card>
    </>}
  </div>;
}
