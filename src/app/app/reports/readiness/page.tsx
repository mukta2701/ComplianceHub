import { requireAppContext } from "@/lib/app-context";
import { loadReadinessInput } from "@/features/reports/application/load-readiness";
import { buildReadinessReport, type ReadinessReport } from "@/features/reports/domain/readiness-report";
import { loadLatestLeadershipSnapshot } from "@/features/reports/application/leadership-snapshots";
import { RISK_BAND_LABEL, type RiskBand } from "@/features/risks/domain/risks";
import { Card, EmptyState, PageIntro, Ring, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { publishLeadershipReportAction } from "./actions";

const BAND_TONE: Record<RiskBand, string> = { low: "green", moderate: "amber", high: "red", very_high: "critical" };

function formatPublishedAt(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function ReportMetrics({ report }: { report: ReadinessReport }) {
  return <>
    <div className="stats-grid" style={{ alignItems: "center" }}>
      <Card style={{ display: "grid", placeItems: "center", padding: "20px" }} aria-label={`Statement of Applicability readiness ${report.soaPercent}%`}><Ring value={report.soaPercent} /></Card>
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

export default async function ReadinessReportPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const latestSnapshot = await loadLatestLeadershipSnapshot(supabase, organisation.id);

  if (membership.role === "member") {
    if (!latestSnapshot) {
      return <>
        <PageIntro eyebrow="REPORTS" title="Leadership report" body="A board-ready summary shared by your workspace operators." />
        <EmptyState icon="file" title="Leadership report not available yet" body="No leadership report is available for members yet. A workspace operator can publish readiness information when it is ready." />
      </>;
    }
    const attribution = latestSnapshot.publisherName ? `Published by ${latestSnapshot.publisherName}` : "Published by a workspace operator";
    return <>
      <PageIntro
        eyebrow="PUBLISHED REPORT"
        title="Leadership readiness report"
        body={`${latestSnapshot.organisationName} · ${attribution} on ${formatPublishedAt(latestSnapshot.publishedAt)}.`}
        action={<a className="button secondary" href="/api/app/reports/readiness/pdf"><Icon name="download" />Download PDF</a>}
      />
      <ReportMetrics report={latestSnapshot.payload} />
    </>;
  }

  const report = buildReadinessReport(await loadReadinessInput(supabase, organisation.id));
  if (!report.soaTotal) {
    return <>
      <PageIntro eyebrow="REPORTS" title="Leadership report" body="A board-ready summary of your readiness posture." />
      <EmptyState
        icon="file"
        title="Run an assessment first"
        body="This report summarises your Statement of Applicability. Complete a gap assessment to generate one, then come back for a board-ready readiness report."
        primary={{ href: "/app/assessment", label: "Start assessment" }}
      />
    </>;
  }

  return <>
    <PageIntro
      eyebrow="LIVE OPERATOR REPORT"
      title="Leadership readiness report"
      body={`A live management view for ${organisation.name}. Publish an immutable snapshot when it is ready for members.`}
      action={<div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <form action={publishLeadershipReportAction}><button className="button primary">Publish to members</button></form>
        <a className="button secondary" href="/api/app/reports/readiness/pdf"><Icon name="download" />Download PDF</a>
      </div>}
    />
    {latestSnapshot && <Card style={{ padding: "14px 18px", marginBottom: "16px" }}>
      <p style={{ color: "#596273", fontSize: "13px", margin: 0 }}>
        Latest member snapshot published {formatPublishedAt(latestSnapshot.publishedAt)}{latestSnapshot.publisherName ? ` by ${latestSnapshot.publisherName}` : ""}.
      </p>
    </Card>}
    <ReportMetrics report={report} />
  </>;
}
