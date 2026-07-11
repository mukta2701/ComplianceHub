import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { RISK_BAND_LABEL, type RiskBand } from "@/features/risks/domain/risks";
import { CHECKLIST_RESULT_LABEL, FINDING_SEVERITY_LABEL, FINDING_STATUS_LABEL, type ChecklistResult, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import type { SoaStatus } from "@/features/soa/domain/soa";
import type { EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, Pill, Ring, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

type Payload = {
  organisationName: string; framework: string;
  soa: { status: SoaStatus }[]; risks: { likelihood: number; impact: number }[];
  tasks: { open: number; overdue: number }; evidence: { status: EvidenceStatus }[];
  audits: { status: string }[]; openNonConformities: number;
  audit: null | { reference: string; title: string; status: string; scope: string;
    checklist: { area: string; clauseReference: string; checklistItem: string; compliant: ChecklistResult; evidenceNote: string }[];
    findings: { summary: string; severity: FindingSeverity; status: FindingStatus }[] };
};

export default async function AuditViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient(); // anon role for a logged-out visitor
  const { data } = await supabase.rpc("audit_view_for_token", { raw_token: token });
  if (!data) {
    return <Card style={{ padding: "24px" }} role="alert"><h1 style={{ fontSize: "20px", margin: "0 0 8px" }}>Link unavailable</h1><p>This auditor link is invalid, has expired, or has been revoked. Ask your contact to issue a new one.</p></Card>;
  }
  const payload = data as Payload;
  const report = buildReadinessReport({ ...payload, config: undefined });
  const BAND_TONE: Record<RiskBand, string> = { low: "green", moderate: "amber", high: "red", very_high: "critical" };
  return <>
    <h1 style={{ fontSize: "24px", margin: "0 0 4px" }}>{payload.organisationName} — readiness</h1>
    <p style={{ color: "#596273", margin: "0 0 20px" }}>{payload.framework} · read-only auditor view</p>
    <div className="stats-grid" style={{ alignItems: "center" }}>
      <Card style={{ display: "grid", placeItems: "center", padding: "20px" }}><Ring value={report.soaPercent} /></Card>
      <Stat label="OPEN TASKS" value={report.tasksOpen} detail={`${report.tasksOverdue} overdue`} tone={report.tasksOverdue > 0 ? "red" : "blue"} />
      <Stat label="EVIDENCE HEALTH" value={report.evidence.total} detail={`${report.evidence.expiring} expiring · ${report.evidence.expired} expired`} tone={report.evidence.expired > 0 ? "red" : "green"} />
      <Stat label="OPEN NON-CONFORMITIES" value={report.openNonConformities} detail={`${report.openAudits} open audits`} tone={report.openNonConformities > 0 ? "amber" : "green"} />
    </div>
    <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 12px" }}>Risk posture</h2>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {(Object.keys(report.riskBands) as RiskBand[]).map((band) => <div key={band} style={{ minWidth: "120px" }}><Stat label={RISK_BAND_LABEL[band].toUpperCase()} value={report.riskBands[band]} detail="risks" tone={BAND_TONE[band] === "critical" ? "red" : BAND_TONE[band]} /></div>)}
      </div>
    </Card>
    {payload.audit && <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>{payload.audit.reference}: {payload.audit.title}</h2>
      <p style={{ color: "#596273", fontSize: "13px", margin: "0 0 12px" }}>{payload.audit.scope}</p>
      <div className="data-table-wrap" role="region" aria-label="Audit checklist" tabIndex={0}><table>
        <thead><tr><th>Area / clause</th><th>Item</th><th>Result</th></tr></thead>
        <tbody>{payload.audit.checklist.map((c, idx) => <tr key={idx}><td>{c.area}<small>{c.clauseReference}</small></td><td>{c.checklistItem}</td><td>{CHECKLIST_RESULT_LABEL[c.compliant]}</td></tr>)}</tbody>
      </table></div>
      <h3 style={{ fontSize: "14px", margin: "16px 0 8px" }}>Findings</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
        {payload.audit.findings.map((f, idx) => <li key={idx}><Pill tone={f.severity === "major_nc" ? "critical" : f.severity === "minor_nc" ? "amber" : "neutral"}>{FINDING_SEVERITY_LABEL[f.severity]}</Pill> {f.summary} <small style={{ color: "#596273" }}>({FINDING_STATUS_LABEL[f.status]})</small></li>)}
        {!payload.audit.findings.length && <li style={{ color: "#596273", fontSize: "13px" }}>No findings recorded.</li>}
      </ul>
    </Card>}
  </>;
}
