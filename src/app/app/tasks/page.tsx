import Link from "next/link";
import { contributionTime } from "@/features/tasks/domain/contributions";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { acceptCalendarSeedAction, updateTaskStatusAction } from "./actions";
import styles from "./tasks.module.css";

const FILTERS = ["all", "assigned", "active", "open", "in_progress", "done", "cancelled", "overdue"] as const;
type TaskFilter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<TaskFilter, string> = { all: "All work", assigned: "Assigned to me", active: "Open work", open: "Open", in_progress: "In progress", done: "Done", cancelled: "Cancelled", overdue: "Overdue" };

function taskStatusTone(status: string) {
  if (status === "done") return "green";
  if (status === "in_progress") return "blue";
  if (status === "cancelled") return "neutral";
  return "amber";
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const requested = (await searchParams).filter ?? "all";
  const filter: TaskFilter = FILTERS.includes(requested as TaskFilter) ? requested as TaskFilter : "all";
  const { supabase, organisation, membership, user } = await requireAppContext();
  const canManage = membership.role !== "member";
  const today = new Date().toISOString().slice(0, 10);

  let query = supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,profiles:owner_id(display_name)").eq("organisation_id", organisation.id);
  if (["open", "in_progress", "done", "cancelled"].includes(filter)) query = query.eq("status", filter);
  if (filter === "assigned") query = query.eq("owner_id", user.id);
  if (filter === "active") query = query.in("status", ["open", "in_progress"]);
  if (filter === "overdue") query = query.in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today);
  query = query.order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(500);

  const [taskResult, openResult, datedResult, overdueResult, recurringResult, totalResult] = await Promise.all([
    query,
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).not("due_on", "is", null),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).not("recurrence", "is", null),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
  ]);
  if (taskResult.error) throw new Error("Could not load tasks");
  if (openResult.error || datedResult.error || overdueResult.error || recurringResult.error || totalResult.error) throw new Error("Could not load task counts");
  if ([openResult.count, datedResult.count, overdueResult.count, recurringResult.count, totalResult.count].some((count) => count === null)) throw new Error("Could not load task counts");
  const tasks = taskResult.data ?? [];
  const openCount = openResult.count ?? 0;
  const datedCount = datedResult.count ?? 0;
  const overdueCount = overdueResult.count ?? 0;
  const recurringCount = recurringResult.count ?? 0;
  const totalCount = totalResult.count ?? 0;

  const { data: pendingRows, error: pendingError } = canManage
    ? await supabase.from("task_contributions").select("id,task_id,submitter_id,assignment_revision,created_at,tasks!inner(id,title,status,owner_id,assignment_revision),profiles:submitter_id(display_name)").eq("organisation_id", organisation.id).eq("decision", "pending").neq("submitter_id", user.id).order("created_at")
    : { data: [], error: null };
  if (pendingError) throw new Error("Could not load contributions awaiting review");
  const reviewQueue = (pendingRows ?? []).flatMap((row) => {
    const task = one(row.tasks); const person = one(row.profiles);
    return task && task.assignment_revision === row.assignment_revision && task.owner_id === row.submitter_id && ["open", "in_progress"].includes(task.status)
      ? [{ id: row.id, taskId: task.id, title: task.title, submitter: person?.display_name ?? "Workspace member", createdAt: row.created_at }] : [];
  });
  const onTrackCount = Math.max(datedCount - overdueCount, 0);
  const undatedCount = Math.max(openCount - datedCount, 0);
  const onTrackPercent = openCount ? Math.round((onTrackCount / openCount) * 100) : 0;
  const overduePercent = openCount ? Math.round((overdueCount / openCount) * 100) : 0;

  return <>
    <PageIntro eyebrow="ACCOUNTABLE WORK" title="Work queue" body="Keep security and compliance work moving from assignment through evidence review, without confusing task completion with verified findings." action={<span className={styles.pageActions}>
      {canManage && <a className="button secondary" href="/api/app/tasks/export?format=xlsx">Export XLSX</a>}
      {canManage && <a className="button secondary" href="/api/app/tasks/export?format=csv">CSV</a>}
      {canManage && <Link className="button primary" href="/app/tasks/new"><Icon name="plus" />New task</Link>}
    </span>} />
    <section className={styles.summaryGrid} aria-label="Work summary">
      <Link href="/app/tasks?filter=active" className={styles.metric}><span>Open work</span><strong>{openCount}</strong><small>Open or in progress</small></Link>
      <Link href="/app/tasks?filter=overdue" className={styles.metric + " " + styles.metricAlert}><span>Overdue</span><strong>{overdueCount}</strong><small>Past the due date</small></Link>
      {canManage && reviewQueue.length > 0 ? <a href="#review-queue" className={styles.metric + " " + styles.metricReview}><span>Awaiting your review</span><strong>{reviewQueue.length}</strong><small>Submissions you can review</small></a>
        : canManage ? <div className={styles.metric + " " + styles.metricReview}><span>Awaiting your review</span><strong>0</strong><small>No submissions you can review</small></div>
          : <div className={styles.metric + " " + styles.metricReview}><span>Recurring</span><strong>{recurringCount}</strong><small>Regenerate on completion</small></div>}
    </section>
    <Card className={styles.healthCard} aria-label="Deadline health">
      <div className={styles.healthHeader}><div><span className={styles.kicker}>Deadline health</span><strong>{openCount === 0 ? "No open tasks to assess" : datedCount === 0 ? "No dated open tasks to assess" : onTrackCount + " of " + datedCount + " dated tasks are on track"}</strong></div><span>{recurringCount} recurring</span></div>
      <div className={styles.healthTrack} role="img" aria-label={openCount === 0 ? "No open tasks to assess" : "Deadline status: " + onTrackCount + " on track, " + overdueCount + " overdue, " + undatedCount + " undated"}>
        <span className={styles.onTrackSegment} style={{ width: onTrackPercent + "%" }} />
        <span className={styles.overdueSegment} style={{ width: overduePercent + "%" }} />
      </div>
      <div className={styles.healthLegend}><span><i className={styles.onTrackDot} />On track {onTrackCount}</span><span><i className={styles.overdueDot} />Overdue {overdueCount}</span><span><i className={styles.undatedDot} />Undated {undatedCount}</span></div>
    </Card>
    <nav aria-label="Task filters" className={styles.filters}>{FILTERS.map((value) => <Link key={value} href={"/app/tasks?filter=" + value} aria-current={filter === value ? "page" : undefined}>{FILTER_LABELS[value]}</Link>)}</nav>
    {canManage && reviewQueue.length > 0 && <Card id="review-queue" className={styles.reviewQueue}>
      <div className={styles.sectionHeader}><div><span className={styles.kicker}>Human decision</span><h2>Awaiting review</h2></div><Pill tone="amber">{reviewQueue.length} pending</Pill></div>
      <div className={styles.reviewList}>{reviewQueue.map((item) => <article key={item.id} className={styles.reviewItem}>
        <span className={styles.avatar} aria-hidden="true">{item.submitter.slice(0, 1).toUpperCase()}</span>
        <div><strong>{item.title}</strong><p>{item.submitter} · <time dateTime={item.createdAt}>{contributionTime(item.createdAt)}</time></p></div>
        <Link className="button secondary" href={"/app/tasks/" + item.taskId}>Review submission</Link>
      </article>)}</div>
    </Card>}
    {canManage && totalCount === 0 && <Card className={styles.starter}><h2>Start with the compliance calendar</h2><p>Add recurring access reviews, policy reviews, and backup restore tests in one click.</p><form action={acceptCalendarSeedAction}><button className="button primary">Add starter calendar</button></form></Card>}
    <Card className={styles.tableCard}>
      <div className={styles.tableHeader}><div><span className={styles.kicker}>Current view</span><h2>{FILTER_LABELS[filter]}</h2></div><span>{tasks.length === 500 ? "Showing first 500" : tasks.length + " task" + (tasks.length === 1 ? "" : "s")}</span></div>
      <div className={"data-table-wrap " + styles.taskTable} role="region" aria-label="Tasks table" tabIndex={0}><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Recurs</th><th>Source</th><th>Status</th></tr></thead><tbody>
        {tasks.map((task) => { const owner = one(task.profiles); const overdue = isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today); return <tr key={task.id}>
          <td data-label="Task" className={styles.taskName}><Link href={"/app/tasks/" + task.id}><b>{task.title}</b></Link>{task.detail && <small>{task.detail}</small>}</td>
          <td data-label="Owner"><span className={styles.owner}><i aria-hidden="true">{(owner?.display_name ?? "U").slice(0, 1).toUpperCase()}</i>{owner?.display_name ?? "Unassigned"}</span></td>
          <td data-label="Due" className={styles.date + " " + (overdue ? "overdue" : "")}>{task.due_on ?? "—"}{overdue && <Pill tone="red">Overdue</Pill>}</td>
          <td data-label="Recurs" className={styles.capitalize}>{task.recurrence ?? "—"}</td>
          <td data-label="Source" className={styles.capitalize}>{task.source.replaceAll("_", " ")}</td>
          <td data-label="Status">{canManage ? <form action={updateTaskStatusAction} className={styles.statusForm}><input type="hidden" name="id" value={task.id} /><select name="status" defaultValue={task.status} aria-label={"Status for " + task.title} className="field"><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select><button className="button secondary">Save</button></form> : <Pill tone={taskStatusTone(task.status)}>{task.status.replaceAll("_", " ")}</Pill>}</td>
        </tr>; })}
        {!tasks.length && <tr><td colSpan={6} className={styles.empty}>No tasks match this filter.</td></tr>}
      </tbody></table></div>
    </Card>
  </>;
}
