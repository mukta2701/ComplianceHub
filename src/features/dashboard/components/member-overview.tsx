import Link from "next/link";
import { Card, PageIntro, Stat } from "@/components/ui";
import type { MemberOverviewData } from "@/features/dashboard/application/load-member-overview";

export function MemberOverview({ data }: { data: MemberOverviewData }) {
  const policyStatus = data.policies.approved === 0
    ? "No approved policies are available yet."
    : `${data.policies.acceptedCurrent} of ${data.policies.approved} current policies accepted`;
  const findingStatus = data.findings.active === 0
    ? "No active findings."
    : `${data.findings.active} active finding${data.findings.active === 1 ? "" : "s"} · ${data.findings.highOrCritical} high or critical`;

  return <>
    <PageIntro
      eyebrow="MEMBER OVERVIEW"
      title={`Welcome to ${data.organisationName}`}
      body={`${data.jobTitle?.trim() || "Member"} · Read-only member view`}
    />

    <div className="stats-grid">
      <Stat label="MY POLICY STATUS" value={`${data.policies.acceptedCurrent}/${data.policies.approved}`} detail="current versions accepted" tone={data.policies.acceptedCurrent === data.policies.approved ? "green" : "blue"} />
      <Stat label="SYSTEMS MONITORED" value={data.connectedSystems.length} detail="visible connected systems" />
      <Stat label="ACTIVE FINDINGS" value={data.findings.active} detail={`${data.findings.highOrCritical} high or critical`} tone={data.findings.highOrCritical > 0 ? "red" : "green"} />
    </div>

    <div className="dashboard-grid" style={{ marginTop: "16px" }}>
      <Card style={{ padding: "20px" }}>
        <h3 style={{ margin: "0 0 8px" }}>Policy acknowledgement</h3>
        <p style={{ color: "#596273", fontSize: "13px" }}>{policyStatus}</p>
        <Link className="button secondary" href="/app/policies">Review policies</Link>
      </Card>

      <Card style={{ padding: "20px" }}>
        <h3 style={{ margin: "0 0 8px" }}>Systems monitored</h3>
        <p style={{ color: "#596273", fontSize: "13px" }}>
          {data.connectedSystems.length > 0
            ? data.connectedSystems.map((source) => source.label || source.provider).join(", ")
            : "No connected systems are currently visible."}
        </p>
        <p style={{ color: "#596273", fontSize: "13px" }}>{findingStatus}</p>
        <Link className="button secondary" href="/app/monitoring">View monitoring</Link>
      </Card>

      <Card style={{ padding: "20px" }}>
        <h3 style={{ margin: "0 0 8px" }}>Leadership report</h3>
        <p style={{ color: "#596273", fontSize: "13px" }}>Read the latest readiness summary shared with your workspace.</p>
        <Link className="button secondary" href="/app/reports/readiness">Open leadership report</Link>
      </Card>
    </div>
  </>;
}
