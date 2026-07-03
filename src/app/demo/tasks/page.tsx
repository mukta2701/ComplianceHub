import { Card, PageIntro, Pill, Stat } from "@/components/ui";

const tasks = [
  { title: "Review user access rights", owner: "Priya Shah", due: "2026-07-15", recurs: "Quarterly", source: "System", status: "Open", overdue: false },
  { title: "Close gap: access rights are reviewed and removed promptly", owner: "Noah Adams", due: "2026-06-20", recurs: "—", source: "Gap", status: "In progress", overdue: true },
  { title: "Test backup restoration", owner: "Priya Shah", due: "2026-11-02", recurs: "Semi-annually", source: "System", status: "Open", overdue: false },
  { title: "Replace stale evidence: access review minutes Q1", owner: "Noah Adams", due: "2026-06-30", recurs: "—", source: "Evidence expiry", status: "Open", overdue: true },
] as const;

export default function DemoTasksPage() {
  return <>
    <PageIntro eyebrow="REMEDIATION" title="Tasks" body="Owned, dated work generated from gaps, evidence expiry and your compliance calendar." />
    <div className="stats-grid"><Stat label="OPEN TASKS" value={3} detail="across all sources" /><Stat label="OVERDUE" value={2} detail="flagged by the daily sweep" tone="red" /><Stat label="RECURRING" value={2} detail="regenerate on completion" tone="green" /></div>
    <Card><div className="data-table-wrap"><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Recurs</th><th>Source</th><th>Status</th></tr></thead><tbody>
      {tasks.map((t) => <tr key={t.title}><td><b>{t.title}</b></td><td>{t.owner}</td><td className={t.overdue ? "overdue" : ""}>{t.due}{t.overdue && <> <Pill tone="red">Overdue</Pill></>}</td><td>{t.recurs}</td><td>{t.source}</td><td><Pill tone={t.status === "Open" ? "blue" : "amber"}>{t.status}</Pill></td></tr>)}
    </tbody></table></div></Card>
  </>;
}
