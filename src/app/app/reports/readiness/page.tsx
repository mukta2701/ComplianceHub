import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { loadReadinessInput } from "@/features/reports/application/load-readiness";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { RISK_BAND_LABEL, type RiskBand } from "@/features/risks/domain/risks";
import { Card, PageIntro, Ring, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

const BAND_TONE: Record<RiskBand, string> = { low: "green", moderate: "amber", high: "red", very_high: "critical" };

export default async function ReadinessReportPage() {
  const { supabase, organisation } = await requireAppContext();
  const report = buildReadinessReport(await loadReadinessInput(supabase));
  return <>
    <PageIntro eyebrow="REPORT" title="Leadership readiness report" body={`A management-review snapshot for ${organisation.name}.`} action={<Link className="button secondary" href="/api/app/reports/readiness/pdf"><Icon name="download" />Download PDF</Link>} />
    <div className="stats-grid" style={{ alignItems: "center" }}>
      <Card className="stat" style={{ justifyContent: "center" }} aria-label={`Statement of Applicability readiness ${report.soaPercent}%`}><Ring value={report.soaPercent} /></Card>
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
  </>;
}
