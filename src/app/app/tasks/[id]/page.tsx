import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill } from "@/components/ui";
import { ticketStatusTone } from "@/features/integrations/domain/mapping";
import { updateTaskStatusAction } from "../actions";
import { pushTaskToTrackerAction } from "./tracker-actions";

const EVIDENCE_TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: task } = await supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,control_id,risk_id,created_at,updated_at").eq("id", id).maybeSingle();
  if (!task) notFound();
  const [{ data: owner }, { data: control }, { data: risk }, { data: evidenceLinks }] = await Promise.all([
    task.owner_id ? supabase.from("profiles").select("display_name").eq("id", task.owner_id).maybeSingle() : Promise.resolve({ data: null }),
    task.control_id ? supabase.from("controls").select("id,code,title").eq("id", task.control_id).maybeSingle() : Promise.resolve({ data: null }),
    task.risk_id ? supabase.from("risks").select("id,reference,title").eq("id", task.risk_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("evidence_links").select("id,evidence(id,title,status,kind)").eq("task_id", id),
  ]);
  const evidence = (evidenceLinks ?? []).map((l) => (Array.isArray(l.evidence) ? l.evidence[0] : l.evidence)).filter((e): e is { id: string; title: string; status: string; kind: string } => Boolean(e));
  const [{ data: ticket }, { data: connections }] = await Promise.all([
    supabase.from("task_tickets").select("external_id,external_url,external_status,external_assignee,last_synced_at").eq("task_id", id).maybeSingle(),
    supabase.from("integration_connections").select("id,provider,label").is("revoked_at", null).order("created_at"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today);
  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <span key="s" style={{ textTransform: "capitalize" }}>{task.status.replaceAll("_", " ")}</span>],
    ["Owner", owner?.display_name ?? "Unassigned"],
    ["Due date", <>{task.due_on ?? "—"}{overdue && <> <Pill tone="red">Overdue</Pill></>}</>],
    ["Recurrence", <span key="r" style={{ textTransform: "capitalize" }}>{task.recurrence ?? "One-off"}</span>],
    ["Source", <span key="src" style={{ textTransform: "capitalize" }}>{task.source.replaceAll("_", " ")}</span>],
    ["Linked control", control ? <Link href="/app/soa">{control.code}: {control.title}</Link> : "—"],
    ["Linked risk", risk ? <Link href="/app/risks">{risk.reference}: {risk.title}</Link> : "—"],
    ["Tracker", ticket
      ? <a href={ticket.external_url} target="_blank" rel="noreferrer"><Pill tone={ticketStatusTone(ticket.external_status)}>{ticket.external_id}: {ticket.external_status}</Pill></a>
      : <span style={{ color: "#596273" }}>Not pushed</span>],
  ];
  return <>
    <Link href="/app/tasks" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to tasks</Link>
    <PageIntro eyebrow="TASK" title={task.title} body="Owned, dated remediation work." />
    <Card style={{ padding: "22px" }}><dl className="fact-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></Card>
    {task.detail && <Card style={{ padding: "22px", marginTop: "16px" }}><h2 style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Detail</h2><p style={{ whiteSpace: "pre-wrap", marginTop: "6px" }}>{task.detail}</p></Card>}
    {evidence.length > 0 && <Card style={{ padding: "22px", marginTop: "16px" }}><h2 style={{ fontSize: "12px", color: "#596273", margin: "0 0 10px" }}>Linked evidence</h2><ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>{evidence.map((e) => <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}><Link href="/app/evidence">{e.title}</Link><Pill tone={EVIDENCE_TONE[e.status] ?? "neutral"}>{e.status}</Pill></li>)}</ul></Card>}
    <form action={updateTaskStatusAction} className="card" style={{ padding: "18px", marginTop: "16px", display: "flex", gap: "10px", alignItems: "center" }}><input type="hidden" name="id" value={task.id} /><label style={{ fontWeight: 700, fontSize: "12px" }}>Update status <select name="status" defaultValue={task.status} style={{ marginLeft: "6px" }}><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label><button className="button primary">Save</button></form>
    {!ticket && (connections?.length ?? 0) > 0 && <form action={pushTaskToTrackerAction} className="card" style={{ padding: "18px", marginTop: "16px", display: "flex", gap: "10px", alignItems: "center" }}>
      <input type="hidden" name="taskId" value={task.id} />
      <label style={{ fontWeight: 700, fontSize: "12px" }}>Send to tracker
        <select name="connectionId" defaultValue={connections![0].id} style={{ marginLeft: "6px" }}>{connections!.map((c) => <option key={c.id} value={c.id}>{c.label || c.provider}</option>)}</select>
      </label>
      <button className="button primary">Send to tracker</button>
    </form>}
  </>;
}
