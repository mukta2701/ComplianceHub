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
import styles from "./task-detail.module.css";

const EVIDENCE_TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };

function taskTone(status: string) {
  if (status === "done") return "green";
  if (status === "in_progress") return "blue";
  if (status === "cancelled") return "neutral";
  return "amber";
}
function taskStatusLabel(status: string) {
  const label = status.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organisation, membership, user } = await requireAppContext();
  const canManage = membership.role !== "member";
  const taskResult = await supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,control_id,risk_id,created_at,updated_at,assignment_revision").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (taskResult.error) throw new Error("Could not load task");
  const task = taskResult.data;
  if (!task) notFound();

  const [monitoringResult, auditResult] = await Promise.all([
    supabase.from("monitoring_findings").select("id,title,status,finding_origin,resolved_at").eq("task_id", id).eq("organisation_id", organisation.id),
    supabase.from("audit_findings").select("id,audit_id,summary,status").eq("task_id", id).eq("organisation_id", organisation.id),
  ]);
  if (monitoringResult.error || auditResult.error) throw new Error("Could not load the task's linked findings");
  const monitoringFindings = monitoringResult.data ?? [];
  const auditFindings = auditResult.data ?? [];

  const [ownerResult, controlResult, riskResult, evidenceResult] = await Promise.all([
    task.owner_id ? supabase.from("profiles").select("display_name").eq("id", task.owner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    task.control_id ? supabase.from("controls").select("id,code,title").eq("id", task.control_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    task.risk_id ? supabase.from("risks").select("id,reference,title").eq("id", task.risk_id).eq("organisation_id", organisation.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("evidence_links").select("id,evidence(id,title,status,kind)").eq("task_id", id).eq("organisation_id", organisation.id),
  ]);
  if (ownerResult.error || controlResult.error || riskResult.error || evidenceResult.error) throw new Error("Could not load task details");
  const owner = ownerResult.data;
  const control = controlResult.data;
  const risk = riskResult.data;
  const evidence = (evidenceResult.data ?? []).map((link) => one(link.evidence)).filter((item): item is { id: string; title: string; status: string; kind: string } => Boolean(item));

  const [ticketResult, connectionsResult, aiResult] = await Promise.all([
    supabase.from("task_tickets").select("external_id,external_url,external_status,external_assignee,last_synced_at").eq("task_id", id).eq("organisation_id", organisation.id).order("external_id"),
    supabase.from("integration_connections").select("id,provider,label").eq("organisation_id", organisation.id).eq("enabled", true).is("revoked_at", null).order("created_at"),
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  if (ticketResult.error || connectionsResult.error || aiResult.error) throw new Error("Could not load task integrations");
  const tickets = ticketResult.data ?? [];
  const connections = connectionsResult.data;
  const aiSettings = aiResult.data;

  const contributionResult = await supabase.from("task_contributions").select("id,submitter_id,assignment_revision,note,created_at,decision,reviewer_id,reviewed_at,rationale,evidence_id").eq("organisation_id", organisation.id).eq("task_id", id).order("created_at", { ascending: false }).order("id");
  if (contributionResult.error) throw new Error("Could not load submission history");
  const contributions = (contributionResult.data ?? []) as Contribution[];
  const peopleIds = [...new Set(contributions.flatMap((item) => [item.submitter_id, item.reviewer_id]).filter((value): value is string => Boolean(value)))];
  const peopleResult = peopleIds.length ? await supabase.from("profiles").select("id,display_name").in("id", peopleIds) : { data: [], error: null };
  if (peopleResult.error) throw new Error("Could not load submission participants");
  const names = Object.fromEntries((peopleResult.data ?? []).map((person) => [person.id, person.display_name ?? "Workspace member"]));

  const today = new Date().toISOString().slice(0, 10);
  const overdue = isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today);
  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <Pill key="s" tone={taskTone(task.status)}>{taskStatusLabel(task.status)}</Pill>],
    ["Owner", owner?.display_name ?? "Unassigned"],
    ["Due date", <span key="d" className={styles.date}>{task.due_on ?? "—"}{overdue && <Pill tone="red">Overdue</Pill>}</span>],
    ["Recurrence", <span key="r" className={styles.capitalize}>{task.recurrence ?? "One-off"}</span>],
    ["Source", <span key="src" className={styles.capitalize}>{task.source.replaceAll("_", " ")}</span>],
    ["Linked control", control ? <Link href="/app/soa">{control.code}: {control.title}</Link> : "—"],
    ["Linked risk", risk ? <Link href={"/app/risks/" + risk.id}>{risk.reference}: {risk.title}</Link> : "—"],
    ["Tracker", tickets.length ? <span className={styles.trackerList}>{tickets.map((ticket) => <span className={styles.tracker} key={ticket.external_id}><a href={ticket.external_url} target="_blank" rel="noreferrer"><Pill tone={ticketStatusTone(ticket.external_status)}>{ticket.external_id}: {ticket.external_status}</Pill></a>{ticket.last_synced_at && <small>Recorded {new Date(ticket.last_synced_at).toISOString()}</small>}</span>)}</span> : <span className={styles.muted}>Not pushed</span>],
  ];

  return <>
    <Link href="/app/tasks" className={styles.back}>← Back to work queue</Link>
    <PageIntro eyebrow="ACCOUNTABLE WORK" title={task.title} body={(owner?.display_name ? "Owned by " + owner.display_name : "Unassigned") + (task.due_on ? " · Due " + task.due_on : "")} action={<span className={styles.headingActions}><Pill tone={taskTone(task.status)}>{taskStatusLabel(task.status)}</Pill>{canManage && <Link className="button secondary" href={"/app/tasks/" + task.id + "/edit"}>Edit task</Link>}</span>} />

    <div className={styles.primaryGrid}>
      <div className={styles.mainColumn}>
        <TaskContributions taskId={task.id} ownerId={task.owner_id} userId={user.id} role={membership.role} status={task.status} assignmentRevision={task.assignment_revision}
          requestId={randomUUID()} names={names} contributions={contributions.map((item) => ({ ...item, reviewRequestId: randomUUID() }))} />
        {task.detail && <Card className={styles.detailCard}><span className={styles.kicker}>Task brief</span><h2>What needs to be done</h2><p>{task.detail}</p></Card>}
        {(monitoringFindings.length > 0 || auditFindings.length > 0) && <Card className={styles.findings}>
          <span className={styles.kicker}>Separate verification</span><h2>Findings linked to this task</h2>
          <p>Completing this task does not resolve its findings. Review their status and verification separately.</p>
          <ul>
            {monitoringFindings.map((finding) => <li key={finding.id}>
              {finding.finding_origin === "github" && finding.status !== "resolved" ? <Link href={"/app/monitoring?finding=" + finding.id}>{finding.title}</Link> : <><strong>{finding.title}</strong> · <Link href="/app/monitoring">Open monitoring</Link></>}
              <p>Finding status: {finding.status.replaceAll("_", " ")}</p>
              {finding.resolved_at && <p>Resolution recorded: <time dateTime={finding.resolved_at}>{new Date(finding.resolved_at).toISOString()}</time></p>}
              <p>{finding.finding_origin === "github" ? "GitHub findings resolve only after a newer fresh passing check. Saved evidence or a completed task cannot substitute for that check." : "Return to monitoring to verify the underlying check. Task completion alone is not verification."}</p>
            </li>)}
            {auditFindings.map((finding) => <li key={finding.id}><Link href={"/app/audits/" + finding.audit_id}>{finding.summary}</Link><p>Finding status: {finding.status.replaceAll("_", " ")}</p><p>Review the audit checklist and supporting evidence before recording the finding&apos;s closure.</p></li>)}
          </ul>
        </Card>}
        {aiSettings?.enabled && <AiSuggestionPanel target={{ targetType: "task", targetId: task.id }} />}
      </div>

      <aside className={styles.sideColumn}>
        <Card className={styles.overviewCard} aria-label="Task overview">
          <div className={styles.sideHeader}><span className={styles.kicker}>Task overview</span><h2>Ownership and timing</h2></div>
          <dl className={styles.facts}>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {canManage && <form action={updateTaskStatusAction} className={styles.statusForm}><input type="hidden" name="id" value={task.id} /><label>Update task status<select name="status" defaultValue={task.status}><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label><button className="button primary">Save status</button></form>}
        </Card>
        {evidence.length > 0 && <Card className={styles.evidence}><span className={styles.kicker}>Supporting records</span><h2>Linked evidence</h2><ul>{evidence.map((item) => <li key={item.id}>{canManage ? <Link href={"/app/evidence?evidence=" + item.id + "#evidence-" + item.id}>{item.title}</Link> : <span>{item.title}</span>}<Pill tone={EVIDENCE_TONE[item.status] ?? "neutral"}>{item.status}</Pill></li>)}</ul></Card>}
        {canManage && tickets.length === 0 && (connections?.length ?? 0) > 0 && <form action={pushTaskToTrackerAction} className={"card " + styles.trackerForm}>
          <input type="hidden" name="taskId" value={task.id} />
          <label>Send to tracker<select name="connectionId" defaultValue={connections![0].id}>{connections!.map((connection) => <option key={connection.id} value={connection.id}>{connection.label || connection.provider}</option>)}</select></label>
          <button className="button secondary">Send to tracker</button>
        </form>}
      </aside>
    </div>
  </>;
}
