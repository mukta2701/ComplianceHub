import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { AUDIT_STATUS_LABEL, CHECKLIST_RESULT_LABEL, CHECKLIST_RESULT_TONE, FINDING_SEVERITY_LABEL, FINDING_SEVERITY_TONE, FINDING_STATUS_LABEL, checklistCompletion, summariseFindings, type AuditStatus, type ChecklistResult, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import { Card, PageIntro, Pill, Progress } from "@/components/ui";
import { updateAuditStatusAction, addChecklistItemAction, updateChecklistItemAction, raiseFindingAction, updateFindingStatusAction } from "../actions";
import { mintAuditorTokenAction, revokeAuditorTokenAction } from "./share-actions";

const RESULTS: ChecklistResult[] = ["not_tested", "compliant", "non_compliant", "not_applicable"];

export default async function AuditDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ link?: string }> }) {
  const { id } = await params;
  const { link } = await searchParams;
  const { supabase } = await requireAppContext();
  const { data: audit } = await supabase.from("audits").select("id,reference,title,scope,status,framework,planned_start,planned_end").eq("id", id).maybeSingle();
  if (!audit) notFound();
  const [{ data: items }, { data: findings }, { data: members }, { data: tokens }] = await Promise.all([
    supabase.from("audit_checklist_items").select("id,area,clause_reference,checklist_item,compliant,evidence_note,findings").eq("audit_id", id).order("position"),
    supabase.from("audit_findings").select("id,summary,severity,status,corrective_action,task_id").eq("audit_id", id).order("created_at"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
    supabase.from("auditor_access_tokens").select("id,label,expires_at,revoked_at,audit_id").order("created_at", { ascending: false }),
  ]);
  const rows = items ?? [];
  const completion = checklistCompletion(rows.map((i) => ({ compliant: i.compliant as ChecklistResult })));
  const f = summariseFindings((findings ?? []).map((x) => ({ severity: x.severity as FindingSeverity, status: x.status as FindingStatus })));
  const status = audit.status as AuditStatus;
  return <>
    <Link href="/app/audits" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to audits</Link>
    <PageIntro eyebrow={`AUDIT ${audit.reference} · ${audit.framework}`} title={audit.title} body={audit.scope || "No scope recorded yet."} action={
      <form action={updateAuditStatusAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input type="hidden" name="id" value={id} />
        <select name="status" defaultValue={status} aria-label="Audit status">{(["planned", "in_progress", "reporting", "closed"] as AuditStatus[]).map((s) => <option key={s} value={s}>{AUDIT_STATUS_LABEL[s]}</option>)}</select>
        <button className="button secondary">Update status</button>
      </form>
    } />

    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Checklist progress</h2>
      <Progress value={completion.percent} />
      <p style={{ fontSize: "12px", color: "#596273", margin: "8px 0 0" }}>{completion.tested} of {completion.total} items tested · {f.openNonConformities} open non-conformities</p>
    </Card>

    <div style={{ display: "flex", gap: "8px", margin: "0 0 16px" }}>
      <Link className="button secondary" href={`/api/app/audits/${id}/pack?format=xlsx`}>Evidence pack (XLSX)</Link>
      <Link className="button secondary" href={`/api/app/audits/${id}/pack?format=csv`}>Evidence pack (CSV)</Link>
    </div>

    <Card style={{ padding: 0 }}><div className="data-table-wrap" role="region" aria-label="Audit checklist" tabIndex={0}><table>
      <thead><tr><th>Area / clause</th><th>Checklist item</th><th>Result</th><th>Evidence &amp; findings</th></tr></thead>
      <tbody>
        {rows.map((i) => <tr key={i.id}>
          <td>{i.area || "—"}<small>{i.clause_reference}</small></td>
          <td>{i.checklist_item}</td>
          <td><Pill tone={CHECKLIST_RESULT_TONE[i.compliant as ChecklistResult]}>{CHECKLIST_RESULT_LABEL[i.compliant as ChecklistResult]}</Pill></td>
          <td>
            <form action={updateChecklistItemAction} style={{ display: "grid", gap: "6px" }}>
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="auditId" value={id} />
              <select name="compliant" defaultValue={i.compliant} aria-label={`Result for ${i.checklist_item}`}>{RESULTS.map((r) => <option key={r} value={r}>{CHECKLIST_RESULT_LABEL[r]}</option>)}</select>
              <input name="evidenceNote" defaultValue={i.evidence_note} placeholder="Evidence" aria-label={`Evidence for ${i.checklist_item}`} />
              <input name="findings" defaultValue={i.findings} placeholder="Findings" aria-label={`Findings for ${i.checklist_item}`} />
              <button className="button secondary">Save</button>
            </form>
          </td>
        </tr>)}
        {!rows.length && <tr><td colSpan={4} style={{ color: "#596273" }}>No checklist items yet. Add the first one below.</td></tr>}
      </tbody>
    </table></div></Card>

    <Card style={{ padding: "18px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add checklist item</h2>
      <form action={addChecklistItemAction} className="app-form">
        <input type="hidden" name="auditId" value={id} />
        <div className="form-grid">
          <label>Area / process<input name="area" maxLength={200} placeholder="e.g. Access control" /></label>
          <label>Clause reference<input name="clauseReference" maxLength={40} placeholder="e.g. A.8.1 or 6.1.2" /></label>
        </div>
        <label>Checklist item<input name="checklistItem" required maxLength={2000} placeholder="The question the auditor asks." /></label>
        <button className="button secondary">Add item</button>
      </form>
    </Card>

    <Card style={{ padding: "18px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Findings</h2>
      <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "grid", gap: "10px" }}>
        {(findings ?? []).map((x) => <li key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "start" }}>
          <div><Pill tone={FINDING_SEVERITY_TONE[x.severity as FindingSeverity]}>{FINDING_SEVERITY_LABEL[x.severity as FindingSeverity]}</Pill> {x.summary}{x.task_id && <small style={{ display: "block", color: "#596273" }}>Corrective-action task raised.</small>}</div>
          <form action={updateFindingStatusAction} style={{ display: "flex", gap: "6px" }}>
            <input type="hidden" name="id" value={x.id} /><input type="hidden" name="auditId" value={id} />
            <select name="status" defaultValue={x.status} aria-label={`Status of finding: ${x.summary}`}>{(["open", "in_progress", "closed"] as FindingStatus[]).map((s) => <option key={s} value={s}>{FINDING_STATUS_LABEL[s]}</option>)}</select>
            <button className="button secondary">Save</button>
          </form>
        </li>)}
        {!findings?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No findings raised yet.</li>}
      </ul>
      <h3 style={{ fontSize: "14px", margin: "0 0 8px" }}>Raise a finding</h3>
      <form action={raiseFindingAction} className="app-form">
        <input type="hidden" name="auditId" value={id} />
        <label>Summary<input name="summary" required maxLength={2000} /></label>
        <div className="form-grid">
          <label>Severity<select name="severity" defaultValue="observation"><option value="observation">Observation</option><option value="minor_nc">Minor non-conformity</option><option value="major_nc">Major non-conformity</option></select></label>
          <label>Owner (for the task)<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
          <label>Due date<input name="dueOn" type="date" /></label>
        </div>
        <label>Corrective action<textarea name="correctiveAction" maxLength={10000} /></label>
        <label style={{ display: "flex", gap: "8px", alignItems: "center", fontWeight: 700 }}><input type="checkbox" name="spawnTask" style={{ width: "auto" }} />Raise a corrective-action task from this finding</label>
        <button className="button primary">Raise finding</button>
      </form>
    </Card>

    <Card style={{ padding: "18px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Share with an auditor</h2>
      <p style={{ fontSize: "12px", color: "#596273", margin: "0 0 12px" }}>Create a time-boxed, read-only link. It needs no login and expires automatically. Copy it now — it is shown only once.</p>
      {link && <Card role="status" style={{ padding: "12px", background: "#eef7ee", borderColor: "#bfe0bf", marginBottom: "12px" }}><b>New link (copy now):</b> <code style={{ wordBreak: "break-all" }}>{`/audit-view/${link}`}</code></Card>}
      <form action={mintAuditorTokenAction} style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "end", marginBottom: "14px" }}>
        <input type="hidden" name="auditId" value={id} />
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Label<input name="label" defaultValue="External auditor" maxLength={160} style={{ display: "block" }} /></label>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Scope<select name="scope" defaultValue="audit" style={{ display: "block" }}><option value="audit">This audit</option><option value="org">Whole readiness view</option></select></label>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Expires (days)<input name="expiresInDays" type="number" min={1} max={90} defaultValue={14} style={{ display: "block", width: "88px" }} /></label>
        <button className="button primary">Create link</button>
      </form>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
        {(tokens ?? []).map((t) => { const state = t.revoked_at ? "Revoked" : new Date(t.expires_at) < new Date() ? "Expired" : "Active"; return <li key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "13px" }}><span>{t.label} · <Pill tone={state === "Active" ? "green" : "neutral"}>{state}</Pill> <small style={{ color: "#596273" }}>expires {new Date(t.expires_at).toISOString().slice(0, 10)}</small></span>{!t.revoked_at && <form action={revokeAuditorTokenAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="auditId" value={id} /><button style={{ color: "var(--red)", border: 0, background: "none", fontWeight: 700 }}>Revoke</button></form>}</li>; })}
        {!tokens?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No auditor links yet.</li>}
      </ul>
    </Card>
  </>;
}
