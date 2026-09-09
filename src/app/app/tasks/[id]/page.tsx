import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { ticketStatusTone } from "@/features/integrations/domain/mapping";
import { updateTaskStatusAction } from "../actions";
import { pushTaskToTrackerAction } from "./tracker-actions";
import { AiSuggestionPanel } from "@/components/ai-suggestion-panel";

import { TaskContributions } from "../task-contributions";
import type { Contribution } from "@/features/tasks/domain/contributions";

const EVIDENCE_TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organisation, membership, user } = await requireAppContext();
  const canManage = membership.role !== "member";
  const { data: task } = await supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,control_id,risk_id,created_at,updated_at,assignment_revision").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (!task) notFound();
  const [monitoringResult, auditResult] = await Promise.all([
    supabase.from("monitoring_findings").select("id,title,status,finding_origin,resolved_at")
      .eq("task_id", id).eq("organisation_id", organisation.id),
    supabase.from("audit_findings").select("id,audit_id,summary,status")
      .eq("task_id", id).eq("organisation_id", organisation.id),
  ]);
  if (monitoringResult.error || auditResult.error) throw new Error("Could not load the task's linked findings");
  const monitoringFindings = monitoringResult.data ?? [];
  const auditFindings = auditResult.data ?? [];
  const [{ data: owner }, { data: control }, { data: risk }, { data: evidenceLinks }] = await Promise.all([
    task.owner_id ? supabase.from("profiles").select("display_name").eq("id", task.owner_id).maybeSingle() : Promise.resolve({ data: null }),
    task.control_id ? supabase.from("controls").select("id,code,title").eq("id", task.control_id).maybeSingle() : Promise.resolve({ data: null }),
    task.risk_id ? supabase.from("risks").select("id,reference,title").eq("id", task.risk_id).eq("organisation_id", organisation.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("evidence_links").select("id,evidence(id,title,status,kind)").eq("task_id", id).eq("organisation_id", organisation.id),
  ]);
  const evidence = (evidenceLinks ?? []).map((l) => one(l.evidence)).filter((e): e is { id: string; title: string; status: string; kind: string } => Boolean(e));
  const [{ data: ticket }, { data: connections }, { data: aiSettings }] = await Promise.all([
    supabase.from("task_tickets").select("external_id,external_url,external_status,external_assignee,last_synced_at").eq("task_id", id).eq("organisation_id", organisation.id).maybeSingle(),
    supabase.from("integration_connections").select("id,provider,label")
      .eq("organisation_id", organisation.id).eq("enabled", true).is("revoked_at", null).order("created_at"),
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  const { data: contributionRows, error: contributionError } = await supabase.from("task_contributions")
    .select("id,submitter_id,assignment_revision,note,created_at,decision,reviewer_id,reviewed_at,rationale,evidence_id")
    .eq("organisation_id", organisation.id).eq("task_id", id).order("created_at", { ascending: false }).order("id");
  if (contributionError) throw new Error("Could not load submission history");
  const contributions = (contributionRows ?? []) as Contribution[];
  const peopleIds = [...new Set(contributions.flatMap((c) => [c.submitter_id, c.reviewer_id]).filter((value): value is string => Boolean(value)))];
  const { data: people } = peopleIds.length ? await supabase.from("profiles").select("id,display_name").in("id", peopleIds) : { data: [] };
  const names = Object.fromEntries((people ?? []).map((person) => [person.id, person.display_name ?? "Workspace member"]));
  const today = new Date().toISOString().slice(0, 10);
  const overdue = isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today);
  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <span key="s" style={{ textTransform: "capitalize" }}>{task.status.replaceAll("_", " ")}</span>],
    ["Owner", owner?.display_name ?? "Unassigned"],
    ["Due date", <>{task.due_on ?? "—"}{overdue && <> <Pill tone="red">Overdue</Pill></>}</>],
    ["Recurrence", <span key="r" style={{ textTransform: "capitalize" }}>{task.recurrence ?? "One-off"}</span>],
    ["Source", <span key="src" style={{ textTransform: "capitalize" }}>{task.source.replaceAll("_", " ")}</span>],
    ["Linked control", control ? <Link href="/app/soa">{control.code}: {control.title}</Link> : "—"],
    ["Linked risk", risk ? <Link href={`/app/risks/${risk.id}`}>{risk.reference}: {risk.title}</Link> : "—"],
    ["Tracker", ticket
      ? <a href={ticket.external_url} target="_blank" rel="noreferrer"><Pill tone={ticketStatusTone(ticket.external_status)}>{ticket.external_id}: {ticket.external_status}</Pill></a>
      : <span style={{ color: "#596273" }}>Not pushed</span>],
  ];
  return <>
    <Link href="/app/tasks" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to tasks</Link>
    <PageIntro eyebrow="TASK" title={task.title} body="Owned, dated remediation work." action={canManage && <Link className="button secondary" href={`/app/tasks/${task.id}/edit`}>Edit task</Link>} />
    <Card style={{ padding: "22px" }}><dl className="fact-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></Card>
    {(monitoringFindings.length > 0 || auditFindings.length > 0) && <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Findings and verification</h2>
      <p>Completing this task does not resolve its findings. Review their status and verification separately.</p>
      <ul style={{ paddingLeft: "20px", display: "grid", gap: "12px" }}>
        {monitoringFindings.map((finding) => <li key={finding.id}>
          {finding.finding_origin === "github" && finding.status !== "resolved"
            ? <Link href={`/app/monitoring?finding=${finding.id}`}>{finding.title}</Link>
            : <><strong>{finding.title}</strong> · <Link href="/app/monitoring">Open monitoring</Link></>}
          <p>Finding status: {finding.status.replaceAll("_", " ")}</p>
          {finding.resolved_at && <p>Resolution recorded: <time dateTime={finding.resolved_at}>{new Date(finding.resolved_at).toISOString()}</time></p>}
          <p>{finding.finding_origin === "github"
            ? "GitHub findings resolve only after a newer fresh passing check. Saved evidence or a completed task cannot substitute for that check."
            : "Return to monitoring to verify the underlying check. Task completion alone is not verification."}</p>
        </li>)}
        {auditFindings.map((finding) => <li key={finding.id}>
          <Link href={`/app/audits/${finding.audit_id}`}>{finding.summary}</Link>
          <p>Finding status: {finding.status.replaceAll("_", " ")}</p>
          <p>Review the audit checklist and supporting evidence before recording the finding&apos;s closure.</p>
        </li>)}
      </ul>
    </Card>}
    {aiSettings?.enabled && <AiSuggestionPanel target={{ targetType: "task", targetId: task.id }} />}
    {task.detail && <Card style={{ padding: "22px", marginTop: "16px" }}><h2 style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Detail</h2><p style={{ whiteSpace: "pre-wrap", marginTop: "6px" }}>{task.detail}</p></Card>}
    <TaskContributions taskId={task.id} ownerId={task.owner_id} userId={user.id} role={membership.role} status={task.status} assignmentRevision={task.assignment_revision}
      requestId={randomUUID()} names={names} contributions={contributions.map((c) => ({ ...c, reviewRequestId: randomUUID() }))} />
    {evidence.length > 0 && <Card style={{ padding: "22px", marginTop: "16px" }}><h2 style={{ fontSize: "12px", color: "#596273", margin: "0 0 10px" }}>Linked evidence</h2><ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>{evidence.map((e) => <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>{canManage ? <Link href={`/app/evidence?evidence=${e.id}#evidence-${e.id}`}>{e.title}</Link> : <span>{e.title}</span>}<Pill tone={EVIDENCE_TONE[e.status] ?? "neutral"}>{e.status}</Pill></li>)}</ul></Card>}
    {canManage && <form action={updateTaskStatusAction} className="card" style={{ padding: "18px", marginTop: "16px", display: "flex", gap: "10px", alignItems: "center" }}><input type="hidden" name="id" value={task.id} /><label style={{ fontWeight: 700, fontSize: "12px" }}>Update status <select name="status" defaultValue={task.status} style={{ marginLeft: "6px" }}><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label><button className="button primary">Save</button></form>}
    {canManage && !ticket && (connections?.length ?? 0) > 0 && <form action={pushTaskToTrackerAction} className="card" style={{ padding: "18px", marginTop: "16px", display: "flex", gap: "10px", alignItems: "center" }}>
      <input type="hidden" name="taskId" value={task.id} />
      <label style={{ fontWeight: 700, fontSize: "12px" }}>Send to tracker
        <select name="connectionId" defaultValue={connections![0].id} style={{ marginLeft: "6px" }}>{connections!.map((c) => <option key={c.id} value={c.id}>{c.label || c.provider}</option>)}</select>
      </label>
      <button className="button primary">Send to tracker</button>
    </form>}
  </>;
}
