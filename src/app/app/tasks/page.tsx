import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { acceptCalendarSeedAction, updateTaskStatusAction } from "./actions";

const FILTERS = ["all", "open", "in_progress", "done", "cancelled", "overdue"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams;
  const { supabase } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);
  const statusFilter = filter === "open" || filter === "in_progress" || filter === "done" || filter === "cancelled" ? filter : null;
  let query = supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,profiles:owner_id(display_name)")
    .order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(500);
  if (statusFilter) query = query.eq("status", statusFilter);
  const [{ data }, { count: openCount }, { count: overdueCount }, { count: recurringCount }, { count: totalCount }] = await Promise.all([
    query,
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today),
    supabase.from("tasks").select("id", { count: "exact", head: true }).not("recurrence", "is", null),
    supabase.from("tasks").select("id", { count: "exact", head: true }),
  ]);
  const all = data ?? [];
  const tasks = all.filter((t) => filter === "all" ? true : filter === "overdue" ? isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today) : t.status === filter);
  return <>
    <PageIntro eyebrow="REMEDIATION" title="Tasks" body="Owned, dated work generated from gaps, evidence expiry and your compliance calendar." action={<span style={{ display: "flex", gap: "8px" }}>
      <a className="button secondary" href="/api/app/tasks/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/tasks/export?format=csv">CSV</a>
      <Link className="button primary" href="/app/tasks/new"><Icon name="plus" />New task</Link>
    </span>} />
    <div className="stats-grid"><Stat label="OPEN TASKS" value={openCount ?? 0} detail="across all sources" /><Stat label="OVERDUE" value={overdueCount ?? 0} detail="past their due date" tone="red" /><Stat label="RECURRING" value={recurringCount ?? 0} detail="regenerate on completion" tone="green" /></div>
    <nav aria-label="Task filters" className="segmented" style={{ marginBottom: "16px" }}>{FILTERS.map((f) => <Link key={f} href={`/app/tasks?filter=${f}`} aria-current={filter === f ? "page" : undefined} className={filter === f ? "active" : ""} style={{ textTransform: "capitalize" }}>{f.replace("_", " ")}</Link>)}</nav>
    {!totalCount && <Card style={{ padding: "20px", marginBottom: "16px" }}><h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Start with the compliance calendar</h2><p style={{ fontSize: "12px", color: "#596273", margin: "0 0 12px" }}>Add recurring access reviews, policy reviews, and backup restore tests in one click.</p><form action={acceptCalendarSeedAction}><button className="button primary">Add starter calendar</button></form></Card>}
    <Card><div className="data-table-wrap" role="region" aria-label="Tasks table" tabIndex={0}><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Recurs</th><th>Source</th><th>Status</th></tr></thead><tbody>
      {tasks.map((t) => { const owner = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles; const overdue = isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today); return <tr key={t.id}>
        <td><Link href={`/app/tasks/${t.id}`}><b>{t.title}</b></Link>{t.detail && <small>{t.detail}</small>}</td>
        <td>{owner?.display_name ?? "Unassigned"}</td>
        <td className={overdue ? "overdue" : ""}>{t.due_on ?? "—"}{overdue && <> <Pill tone="red">Overdue</Pill></>}</td>
        <td style={{ textTransform: "capitalize" }}>{t.recurrence ?? "—"}</td><td style={{ textTransform: "capitalize" }}>{t.source.replaceAll("_", " ")}</td>
        <td><form action={updateTaskStatusAction} style={{ display: "flex", gap: "6px", alignItems: "center" }}><input type="hidden" name="id" value={t.id} /><select name="status" defaultValue={t.status} aria-label={`Status for ${t.title}`} className="field"><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Save</button></form></td>
      </tr>; })}
      {!tasks.length && <tr><td colSpan={6} style={{ color: "#596273" }}>No tasks match this filter.</td></tr>}
    </tbody></table></div></Card>
  </>;
}
