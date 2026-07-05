import { Card, PageIntro, Pill, Stat } from "@/components/ui";

const evidence = [
  { title: "MFA enforcement report", kind: "File", linked: "CH-082: strong authentication methods", until: "2027-01-15", status: "Current", tone: "green" },
  { title: "Access review minutes Q2", kind: "File", linked: "CH-016: access entitlement reviews", until: "2026-07-20", status: "Expiring", tone: "amber" },
  { title: "Access review minutes Q1", kind: "File", linked: "CH-016: access entitlement reviews", until: "2026-06-30", status: "Expired", tone: "red" },
  { title: "Supplier security clause register", kind: "Link", linked: "CH-020: security clauses in supplier contracts", until: "—", status: "Current", tone: "green" },
] as const;

export default function DemoEvidencePage() {
  return <>
    <PageIntro eyebrow="EVIDENCE" title="Evidence vault" body="Immutable proof attached to controls — freshness is re-checked by the daily sweep, and stale items raise tasks automatically." />
    <div className="stats-grid"><Stat label="EVIDENCE ITEMS" value={4} detail="files, links and notes" /><Stat label="EXPIRING SOON" value={1} detail="within 30 days" tone="amber" /><Stat label="EXPIRED" value={1} detail="replacement task raised" tone="red" /></div>
    <Card><div className="data-table-wrap" role="region" aria-label="Evidence table" tabIndex={0}><table><thead><tr><th>Evidence</th><th>Kind</th><th>Linked control</th><th>Valid until</th><th>Status</th></tr></thead><tbody>
      {evidence.map((e) => <tr key={e.title}><td><b>{e.title}</b></td><td>{e.kind}</td><td>{e.linked}</td><td>{e.until}</td><td><Pill tone={e.tone}>{e.status}</Pill></td></tr>)}
    </tbody></table></div></Card>
  </>;
}
