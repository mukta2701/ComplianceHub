import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE, summariseFindings, type AuditStatus, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function AuditsPage() {
  const { supabase } = await requireAppContext();
  const [{ data: audits }, { data: findings }] = await Promise.all([
    supabase.from("audits").select("id,reference,title,status,planned_start,planned_end").order("reference"),
    supabase.from("audit_findings").select("severity,status"),
  ]);
  const rows = audits ?? [];
  const openAudits = rows.filter((a) => a.status !== "closed").length;
  const f = summariseFindings((findings ?? []).map((x) => ({ severity: x.severity as FindingSeverity, status: x.status as FindingStatus })));
  return <>
    <PageIntro eyebrow="AUDIT" title="Internal audits" body="Plan an audit, work the clause and control checklist, and turn findings into owned corrective actions." action={<Link className="button primary" href="/app/audits/new"><Icon name="plus" />Plan an audit</Link>} />
    <div className="stats-grid">
      <Stat label="OPEN AUDITS" value={openAudits} detail="not yet closed" />
      <Stat label="OPEN FINDINGS" value={f.open} detail="awaiting closure" tone="amber" />
      <Stat label="NON-CONFORMITIES" value={f.openNonConformities} detail="minor or major, still open" tone="red" />
    </div>
    <Card><div className="data-table-wrap" role="region" aria-label="Internal audits table" tabIndex={0}><table>
      <thead><tr><th>Ref</th><th>Audit</th><th>Status</th><th>Window</th></tr></thead>
      <tbody>
        {rows.map((a) => <tr key={a.id}>
          <td>{a.reference}</td>
          <td><Link href={`/app/audits/${a.id}`}><b>{a.title}</b></Link></td>
          <td><Pill tone={AUDIT_STATUS_TONE[a.status as AuditStatus]}>{AUDIT_STATUS_LABEL[a.status as AuditStatus]}</Pill></td>
          <td>{a.planned_start ?? "—"} → {a.planned_end ?? "—"}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={4} style={{ color: "#596273" }}>No audits yet. Plan your first internal audit to start the checklist.</td></tr>}
      </tbody>
    </table></div></Card>
  </>;
}
