import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { RISK_BAND_LABEL, type RiskBand } from "@/features/risks/domain/risks";
import { AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE, CHECKLIST_RESULT_LABEL, CHECKLIST_RESULT_TONE, FINDING_SEVERITY_LABEL, FINDING_SEVERITY_TONE, FINDING_STATUS_LABEL, checklistCompletion, type AuditStatus, type ChecklistResult, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import type { SoaStatus } from "@/features/soa/domain/soa";
import type { EvidenceKind, EvidenceStatus } from "@/features/evidence/domain/evidence";
import { EVIDENCE_PROVIDER_LABELS, type EvidenceProviderKind } from "@/features/integrations/domain/evidence-provider";
import { ProofRecord } from "@/features/evidence/components/proof-record";
import { Card, Pill, Ring, Stat } from "@/components/ui";
import styles from "../audit-view.module.css";

export const dynamic = "force-dynamic";

type LinkedEvidence = {
  id:string;
  title:string;
  kind:EvidenceKind;
  status:EvidenceStatus;
  collectedOn:string|null;
  validUntil:string|null;
  sourceProvider:EvidenceProviderKind|null;
  sourceLabel:string|null;
  linkedOn:string;
};

type ChecklistItem = {
  id:string;
  area:string;
  clauseReference:string;
  checklistItem:string;
  compliant:ChecklistResult;
  evidenceNote:string;
  linkedEvidence:LinkedEvidence[];
};

type Payload = {
  organisationName:string;
  accessScope:"audit"|"organisation";
  framework:string;
  generatedAt:string;
  soa:{ status:SoaStatus }[];
  risks:{ likelihood:number;impact:number }[];
  tasks:{ open:number;overdue:number };
  evidence:{ status:EvidenceStatus }[];
  audits:{ status:string }[];
  openNonConformities:number;
  audit:null|{
    reference:string;
    title:string;
    status:AuditStatus;
    scope:string;
    checklist:ChecklistItem[];
    findings:{ summary:string;severity:FindingSeverity;status:FindingStatus;checklistItemId:string|null }[];
  };
};

const BAND_TONE:Record<RiskBand,string> = { low:"green",moderate:"amber",high:"red",very_high:"red" };

function displayDateTime(value:string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle:"medium",timeStyle:"short",timeZone:"UTC" }).format(new Date(value));
}

function evidenceSource(proof:LinkedEvidence) {
  const provider = proof.sourceProvider ? EVIDENCE_PROVIDER_LABELS[proof.sourceProvider] : null;
  if (proof.sourceLabel) return provider ? `${proof.sourceLabel} (${provider})` : proof.sourceLabel;
  return provider ?? "Added in ComplianceHub";
}

export default async function AuditViewPage({ params }: { params:Promise<{ token:string }> }) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const { data,error } = await supabase.rpc("audit_view_for_token", { raw_token:token });
  if (error || !data) return <Card className={styles.unavailable} role="alert"><h1>Link unavailable</h1><p>This link may be invalid, expired, revoked, or temporarily unavailable. Wait a minute and try again; if it remains unavailable, ask your contact to check it.</p></Card>;

  const payload = data as Payload;
  const report = buildReadinessReport({ ...payload,config:undefined });
  const isOrganisationView = payload.accessScope === "organisation";
  const completion = payload.audit ? checklistCompletion(payload.audit.checklist.map((item) => ({ compliant:item.compliant }))) : null;
  const checklistById = new Map(payload.audit?.checklist.map((item) => [item.id,item.checklistItem]) ?? []);

  return <div className={styles.page}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>READ-ONLY AUDITOR VIEW</span><h1>{payload.organisationName} — {isOrganisationView ? "readiness" : "audit review"}</h1><p>{payload.framework} · point-in-time {isOrganisationView ? "compliance" : "audit"} workspace</p></div>
      <div className={styles.generated}><span>Generated</span><time dateTime={payload.generatedAt}>{displayDateTime(payload.generatedAt)} UTC</time></div>
    </header>

    <Card className={styles.truthNote}><strong>How to read this view</strong><p>{isOrganisationView ? "Readiness totals summarise recorded work. " : "This link is limited to the named audit. "}Evidence freshness describes each record; checklist results and findings remain human audit decisions.</p></Card>

    {isOrganisationView && <section aria-labelledby="readiness-summary">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>PROGRAMME SIGNALS</span><h2 id="readiness-summary">Readiness summary</h2></div><span className={styles.readOnlyBadge}>Read only</span></div>
      <div className={styles.summaryGrid}>
        <Card className={`${styles.metricCard} ${styles.ringCard}`}><Ring value={report.soaPercent} /><p>Statement of Applicability progress</p></Card>
        <Stat label="OPEN TASKS" value={report.tasksOpen} detail={`${report.tasksOverdue} overdue`} tone={report.tasksOverdue > 0 ? "red" : "blue"} />
        <Stat label="EVIDENCE HEALTH" value={report.evidence.total} detail={`${report.evidence.expiring} expiring · ${report.evidence.expired} expired`} tone={report.evidence.expired > 0 ? "red" : "green"} />
        <Stat label="OPEN NON-CONFORMITIES" value={report.openNonConformities} detail={`${report.openAudits} open audits`} tone={report.openNonConformities > 0 ? "amber" : "green"} />
      </div>
    </section>}

    {isOrganisationView && <Card className={styles.riskCard}>
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>RISK REGISTER</span><h2>Risk posture</h2></div><span className={styles.totalLabel}>{payload.risks.length} recorded risks</span></div>
      <div className={styles.riskGrid}>{(Object.keys(report.riskBands) as RiskBand[]).map((band) => <Stat key={band} label={RISK_BAND_LABEL[band].toUpperCase()} value={report.riskBands[band]} detail="risks" tone={BAND_TONE[band]} />)}</div>
    </Card>}

    {payload.audit && <Card className={styles.auditCard}>
      <div className={styles.auditHeader}><div><span className={styles.eyebrow}>AUDIT WORKSPACE</span><h2>{payload.audit.reference}: {payload.audit.title}</h2><p>{payload.audit.scope || "No scope recorded."}</p></div><Pill tone={AUDIT_STATUS_TONE[payload.audit.status]}>{AUDIT_STATUS_LABEL[payload.audit.status]}</Pill></div>
      <div className={styles.auditSummary} aria-label="Audit progress"><div><span>Checklist progress</span><strong>{completion?.percent ?? 0}%</strong><small>{completion?.tested ?? 0} of {completion?.total ?? 0} tested</small></div><div><span>Linked proof</span><strong>{payload.audit.checklist.reduce((total,item) => total + item.linkedEvidence.length,0)}</strong><small>records attached to checklist items</small></div><div><span>Formal findings</span><strong>{payload.audit.findings.length}</strong><small>human-recorded audit outcomes</small></div></div>

      <section className={styles.checklistSection} aria-labelledby="auditor-checklist"><div className={styles.sectionHeading}><div><h3 id="auditor-checklist">Control checklist</h3><p>Each result is shown with the note and proof that support the reviewer’s decision.</p></div></div><ol className={styles.checklist}>
        {payload.audit.checklist.map((item,index) => <li key={item.id || index} className={styles.checklistItem}><div className={styles.checklistTop}><span className={styles.clause}><small>{item.area || "Unspecified area"}</small><strong>{item.clauseReference || `Item ${index + 1}`}</strong></span><Pill tone={CHECKLIST_RESULT_TONE[item.compliant]}>{CHECKLIST_RESULT_LABEL[item.compliant]}</Pill></div><h4>{item.checklistItem}</h4><div className={styles.decisionNote}><span>Audit evidence note</span><p>{item.evidenceNote || "No evidence note recorded."}</p></div><div className={styles.proofList}>{item.linkedEvidence.map((proof) => <ProofRecord key={proof.id} record={{ id:proof.id,title:proof.title,kind:proof.kind,status:proof.status,collectedOn:proof.collectedOn,validUntil:proof.validUntil,sourceLabel:evidenceSource(proof) }} today={payload.generatedAt.slice(0,10)} href={null} />)}{!item.linkedEvidence.length && <p className={styles.empty}>No structured evidence linked to this checklist item.</p>}</div></li>)}
        {!payload.audit.checklist.length && <li className={styles.empty}>No checklist items recorded.</li>}
      </ol></section>

      <section className={styles.findingsSection} aria-labelledby="auditor-findings"><div className={styles.sectionHeading}><div><h3 id="auditor-findings">Formal findings</h3><p>Findings retain their severity, status and checklist context.</p></div></div><ul className={styles.findings}>{payload.audit.findings.map((finding,index) => <li key={`${finding.summary}-${index}`}><div><strong>{finding.summary}</strong>{finding.checklistItemId && checklistById.has(finding.checklistItemId) && <small>Checklist: {checklistById.get(finding.checklistItemId)}</small>}</div><span><Pill tone={FINDING_SEVERITY_TONE[finding.severity]}>{FINDING_SEVERITY_LABEL[finding.severity]}</Pill><Pill tone="neutral">{FINDING_STATUS_LABEL[finding.status]}</Pill></span></li>)}{!payload.audit.findings.length && <li className={styles.empty}>No findings recorded.</li>}</ul></section>
    </Card>}
  </div>;
}
