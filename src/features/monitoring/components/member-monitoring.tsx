import type { ReactNode } from "react";
import { Card, PageIntro, Pill } from "@/components/ui";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import type { MemberMonitoringData } from "@/features/monitoring/application/load-member-monitoring";
import type { CheckSeverity } from "@/features/monitoring/domain/monitor-provider";
import { OfficialGitHubFindingCard } from "@/features/github/components/github-record-provenance";

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

export function MemberMonitoring({
  data,
  selectedFinding = null,
  hasActiveGitHubInstallation = false,
  githubMonitoring,
  githubTechnicalReview,
}: {
  data: MemberMonitoringData;
  selectedFinding?: string | null;
  hasActiveGitHubInstallation?: boolean;
  githubMonitoring?: ReactNode;
  githubTechnicalReview?: ReactNode;
}) {
  const highOrCritical = data.findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "critical",
  ).length;
  const otherSystems = data.connectedSystems.filter((source) => source.provider !== "github");
  const monitoredSystemCount = otherSystems.length + (hasActiveGitHubInstallation ? 1 : 0);

  return <div className="monitoring-page">
    <PageIntro
      eyebrow="MONITORING"
      title="Continuous monitoring"
      body="A read-only view of the systems your workspace monitors and the active findings they have raised."
    />

    <Card className="monitor-banner" style={{ marginBottom: "16px" }}>
      <span className={`monitor-dot ${data.findings.length === 0 ? "neutral" : "watch"}`} aria-hidden="true" />
      <div>
        <strong>{data.findings.length === 0 ? "No recorded active findings" : `${data.findings.length} active finding${data.findings.length === 1 ? "" : "s"}`}</strong>
        <p>{highOrCritical} high or critical · {monitoredSystemCount} system{monitoredSystemCount === 1 ? "" : "s"} monitored{data.findings.length === 0 ? ". Monitoring status is not yet confirmed." : ""}</p>
      </div>
    </Card>

    {githubMonitoring}

    <Card className="monitor-findings-card">
      <div className="card-head"><div><h3>Active findings</h3><p>Current violations and drift, newest first</p></div></div>
      {data.findings.length > 0
        ? <ul className="finding-list">
            {data.findings.map((finding) => {
              const official = data.officialGitHubFindings.find((record) => record.findingId === finding.id);
              if (finding.origin === "github") {
                if (!official) throw new Error("Could not load member monitoring");
                return <li key={finding.id} data-status={finding.status}>
                <OfficialGitHubFindingCard
                  record={official}
                  status={finding.status}
                  taskId={null}
                  role="member"
                  selected={selectedFinding === finding.id}
                />
              </li>;
              }
              return <li key={finding.id} data-status={finding.status}>
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
            </li>;
            })}
          </ul>
        : <p className="empty-note">No recorded active findings.</p>}
    </Card>

    {otherSystems.length > 0 && <Card className="monitor-other-systems-card">
      <div className="card-head"><div><h3>Other monitored systems</h3><p>Other systems included in your workspace monitoring</p></div></div>
      <ul className="monitor-list">
            {otherSystems.map((source) => <li key={source.id}>
              <span className="ml-body">
                <strong>{source.label || providerLabel(source.provider)}</strong>
                <span className="ml-meta">
                  <Pill tone="neutral">{providerLabel(source.provider)}</Pill>
                  <StatusLabel tone="confirmed">Connected {new Date(source.connectedAt).toLocaleDateString("en-GB")}</StatusLabel>
                </span>
              </span>
            </li>)}
      </ul>
    </Card>}

    {githubTechnicalReview}
  </div>;
}
