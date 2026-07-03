import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { acceptCalendarSeedAction, updateTaskStatusAction } from "./actions";

const FILTERS = ["all", "open", "in_progress", "done", "cancelled", "overdue"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams;
  const { supabase } = await requireAppContext();
  let query = supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,profiles:owner_id(display_name)").order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  if (filter !== "all" && filter !== "overdue") query = query.eq("status", filter);
  const { data } = await query;
  const today = new Date().toISOString().slice(0, 10);
  const tasks = (data ?? []).filter((t) => filter !== "overdue" || isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today));
  return <main className="mx-auto max-w-6xl px-6 py-10">
    <div className="flex justify-between"><div><h1 className="text-3xl font-bold">Tasks</h1><p className="mt-2 text-slate-600">Owned, dated remediation work driving your readiness.</p></div><Link href="/app/tasks/new" className="rounded bg-blue-600 px-4 py-2 text-white">New task</Link></div>
    <nav aria-label="Task filters" className="mt-6 flex gap-2 text-sm">{FILTERS.map((f) => <Link key={f} href={`/app/tasks?filter=${f}`} aria-current={filter === f ? "page" : undefined} className={`rounded-full border px-3 py-1 capitalize ${filter === f ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300"}`}>{f.replace("_", " ")}</Link>)}</nav>
    {!data?.length && <section className="mt-8 rounded-xl border border-blue-200 bg-blue-50 p-5"><h2 className="font-semibold">Start with the compliance calendar</h2><p className="mt-1 text-sm text-slate-600">Add recurring access reviews, policy reviews, and backup restore tests in one click.</p><form action={acceptCalendarSeedAction}><button className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm text-white">Add starter calendar</button></form></section>}
    <div className="mt-8 overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{["Task", "Owner", "Due", "Recurs", "Source", "Status"].map((h) => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>
      {tasks.map((t) => { const owner = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles; const overdue = isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today); return <tr key={t.id} className="border-t">
        <td className="p-3"><Link href={`/app/tasks/${t.id}`} className="font-bold text-blue-700 hover:underline">{t.title}</Link>{t.detail && <><br /><span className="text-slate-500">{t.detail}</span></>}</td>
        <td className="p-3">{owner?.display_name ?? "Unassigned"}</td>
        <td className="p-3">{t.due_on ?? "—"}{overdue && <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span>}</td>
        <td className="p-3 capitalize">{t.recurrence ?? "—"}</td><td className="p-3 capitalize">{t.source.replaceAll("_", " ")}</td>
        <td className="p-3"><form action={updateTaskStatusAction}><input type="hidden" name="id" value={t.id} /><select name="status" defaultValue={t.status} aria-label={`Status for ${t.title}`} className="rounded border px-2 py-1"><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select><button className="ml-2 text-blue-700">Save</button></form></td>
      </tr>; })}
      {!tasks.length && <tr><td className="p-4 text-slate-500" colSpan={6}>No tasks match this filter.</td></tr>}
    </tbody></table></div>
  </main>;
}
