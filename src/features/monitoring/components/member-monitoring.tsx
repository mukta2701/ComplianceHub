import { Card, PageIntro, Pill } from "@/components/ui";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import type { MemberMonitoringData } from "@/features/monitoring/application/load-member-monitoring";
import type { CheckSeverity } from "@/features/monitoring/domain/monitor-provider";

const SEVERITY_TONE: Record<CheckSeverity, StatusTone> = {
  critical: "risk",
  high: "risk",
  medium: "attention",
  low: "neutral",
};
const SEVERITY_PILL: Record<CheckSeverity, string> = {
  critical: "red",
  high: "red",
  medium: "amber",
  low: "blue",
};

function providerLabel(provider: string): string {
  return provider.length > 0 ? provider[0].toUpperCase() + provider.slice(1) : "System";
}

export function MemberMonitoring({ data }: { data: MemberMonitoringData }) {
  const highOrCritical = data.findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "critical",
  ).length;

  return <>
    <PageIntro
      eyebrow="MONITORING"
      title="Continuous monitoring"
      body="A read-only view of the systems your workspace monitors and the active findings they have raised."
    />

    <Card className="monitor-banner" style={{ marginBottom: "16px" }}>
      <span className={`monitor-dot ${data.findings.length === 0 ? "ok" : "watch"}`} aria-hidden="true" />
      <div>
        <strong>{data.findings.length === 0 ? "No active findings" : `${data.findings.length} active finding${data.findings.length === 1 ? "" : "s"}`}</strong>
        <p>{highOrCritical} high or critical · {data.connectedSystems.length} system{data.connectedSystems.length === 1 ? "" : "s"} monitored</p>
      </div>
    </Card>

    <Card style={{ marginBottom: "16px" }}>
      <div className="card-head"><div><h3>Connected systems</h3><p>Systems included in your workspace monitoring</p></div></div>
      {data.connectedSystems.length > 0
        ? <ul className="monitor-list">
            {data.connectedSystems.map((source) => <li key={source.id}>
              <span className="ml-body">
                <strong>{source.label || providerLabel(source.provider)}</strong>
                <span className="ml-meta">
                  <Pill tone="neutral">{providerLabel(source.provider)}</Pill>
                  <StatusLabel tone="confirmed">Connected {new Date(source.connectedAt).toLocaleDateString("en-GB")}</StatusLabel>
                </span>
              </span>
            </li>)}
          </ul>
        : <p className="empty-note">No systems are currently being monitored for this workspace.</p>}
    </Card>

    <Card>
      <div className="card-head"><div><h3>Active findings</h3><p>Current violations and drift, newest first</p></div></div>
      {data.findings.length > 0
        ? <ul className="finding-list">
            {data.findings.map((finding) => <li key={finding.id} data-status={finding.status}>
              <div className="finding-head">
                <Pill tone={SEVERITY_PILL[finding.severity]}>{finding.severity}</Pill>
                <strong>{finding.title}</strong>
                <Pill tone={finding.status === "open" ? "red" : "amber"}>{finding.status}</Pill>
              </div>
              <p className="finding-detail">{finding.detail}</p>
              <div className="finding-meta">
                <StatusLabel tone={SEVERITY_TONE[finding.severity]}>{finding.controlRef}</StatusLabel>
                <span>Detected {new Date(finding.detectedAt).toLocaleString("en-GB")}</span>
              </div>
            </li>)}
          </ul>
        : <p className="empty-note">No active findings are currently visible.</p>}
    </Card>
  </>;
}
