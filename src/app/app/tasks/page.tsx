import Link from "next/link";
import { contributionTime } from "@/features/tasks/domain/contributions";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { acceptCalendarSeedAction, updateTaskStatusAction } from "./actions";

const FILTERS = ["all", "assigned", "open", "in_progress", "done", "cancelled", "overdue"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams;
  const { supabase, organisation, membership, user } = await requireAppContext();
  const canManage = membership.role !== "member";
  const today = new Date().toISOString().slice(0, 10);
  const statusFilter = filter === "open" || filter === "in_progress" || filter === "done" || filter === "cancelled" ? filter : null;
  let query = supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,profiles:owner_id(display_name)").eq("organisation_id", organisation.id)
    .order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(500);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (filter === "assigned") query = query.eq("owner_id", user.id);
  const [{ data }, { count: openCount }, { count: overdueCount }, { count: recurringCount }, { count: totalCount }] = await Promise.all([
    query,
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).not("recurrence", "is", null),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
  ]);
  const all = data ?? [];
  const tasks = all.filter((t) => filter === "all" || filter === "assigned" ? true : filter === "overdue" ? isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today) : t.status === filter);
  const { data: pendingRows, error: pendingError } = canManage
    ? await supabase.from("task_contributions")
      .select("id,task_id,submitter_id,assignment_revision,created_at,tasks!inner(id,title,status,owner_id,assignment_revision),profiles:submitter_id(display_name)")
      .eq("organisation_id", organisation.id).eq("decision", "pending").neq("submitter_id", user.id)
      .order("created_at")
    : { data: [], error: null };
  if (pendingError) throw new Error("Could not load contributions awaiting review");
  const reviewQueue = (pendingRows ?? []).flatMap((row) => {
    const task = one(row.tasks); const person = one(row.profiles);
    return task && task.assignment_revision === row.assignment_revision && task.owner_id === row.submitter_id && ["open", "in_progress"].includes(task.status)
      ? [{ id: row.id, taskId: task.id, title: task.title, submitter: person?.display_name ?? "Workspace member", createdAt: row.created_at }] : [];
  });
  return <>
    <PageIntro eyebrow="REMEDIATION" title="Tasks" body="See who owns each action and when it is due. Completing a task records the work done; findings still need their own verification." action={<span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {canManage && <a className="button secondary" href="/api/app/tasks/export?format=xlsx">Export XLSX</a>}
      {canManage && <a className="button secondary" href="/api/app/tasks/export?format=csv">CSV</a>}
      {canManage && <Link className="button primary" href="/app/tasks/new"><Icon name="plus" />New task</Link>}
    </span>} />
    <div className="stats-grid"><Stat label="OPEN TASKS" value={openCount ?? 0} detail="across all sources" /><Stat label="OVERDUE" value={overdueCount ?? 0} detail="past their due date" tone="red" /><Stat label="RECURRING" value={recurringCount ?? 0} detail="regenerate on completion" tone="green" /></div>
    <nav aria-label="Task filters" className="segmented" style={{ marginBottom: "16px" }}>{FILTERS.map((f) => <Link key={f} href={`/app/tasks?filter=${f}`} aria-current={filter === f ? "page" : undefined} className={filter === f ? "active" : ""} style={{ textTransform: "capitalize" }}>{f === "assigned" ? "Assigned to me" : f.replace("_", " ")}</Link>)}</nav>
    {canManage && reviewQueue.length > 0 && <Card style={{ padding: "20px", marginBottom: "16px" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: "17px" }}>Awaiting your review</h2>
      <div style={{ display: "grid", gap: "12px" }}>{reviewQueue.map((item) => <article key={item.id} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "12px", borderTop: "1px solid var(--line, #e0e4ec)", paddingTop: "12px" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0, overflowWrap: "anywhere" }}><strong>{item.title}</strong><p style={{ margin: "6px 0" }}>{item.submitter} · <time dateTime={item.createdAt}>{contributionTime(item.createdAt)}</time></p></div>
        <Pill tone="amber">Awaiting review</Pill><Link className="button secondary" href={`/app/tasks/${item.taskId}`}>Review</Link>
      </article>)}</div>
    </Card>}
    {canManage && !totalCount && <Card style={{ padding: "20px", marginBottom: "16px" }}><h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Start with the compliance calendar</h2><p style={{ fontSize: "12px", color: "#596273", margin: "0 0 12px" }}>Add recurring access reviews, policy reviews, and backup restore tests in one click.</p><form action={acceptCalendarSeedAction}><button className="button primary">Add starter calendar</button></form></Card>}
    <Card><div className="data-table-wrap" role="region" aria-label="Tasks table" tabIndex={0}><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Recurs</th><th>Source</th><th>Status</th></tr></thead><tbody>
      {tasks.map((t) => { const owner = one(t.profiles); const overdue = isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today); return <tr key={t.id}>
        <td><Link href={`/app/tasks/${t.id}`}><b>{t.title}</b></Link>{t.detail && <small>{t.detail}</small>}</td>
        <td>{owner?.display_name ?? "Unassigned"}</td>
        <td className={overdue ? "overdue" : ""}>{t.due_on ?? "—"}{overdue && <> <Pill tone="red">Overdue</Pill></>}</td>
        <td style={{ textTransform: "capitalize" }}>{t.recurrence ?? "—"}</td><td style={{ textTransform: "capitalize" }}>{t.source.replaceAll("_", " ")}</td>
        <td>{canManage && <form action={updateTaskStatusAction} style={{ display: "flex", gap: "6px", alignItems: "center" }}><input type="hidden" name="id" value={t.id} /><select name="status" defaultValue={t.status} aria-label={`Status for ${t.title}`} className="field"><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Save</button></form>}{!canManage && <span style={{ textTransform: "capitalize" }}>{t.status.replaceAll("_", " ")}</span>}</td>
      </tr>; })}
      {!tasks.length && <tr><td colSpan={6} style={{ color: "#596273" }}>No tasks match this filter.</td></tr>}
    </tbody></table></div></Card>
  </>;
}
