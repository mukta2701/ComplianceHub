import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { updateTaskStatusAction } from "../actions";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: task } = await supabase.from("tasks")
    .select("id,title,detail,status,due_on,recurrence,source,owner_id,control_id,risk_id,created_at,updated_at")
    .eq("id", id).maybeSingle();
  if (!task) notFound();
  const [{ data: owner }, { data: control }, { data: risk }, { data: evidenceLinks }] = await Promise.all([
    task.owner_id ? supabase.from("profiles").select("display_name").eq("id", task.owner_id).maybeSingle() : Promise.resolve({ data: null }),
    task.control_id ? supabase.from("controls").select("id,code,title").eq("id", task.control_id).maybeSingle() : Promise.resolve({ data: null }),
    task.risk_id ? supabase.from("risks").select("id,reference,title").eq("id", task.risk_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("evidence_links").select("id,evidence(id,title,status,kind)").eq("task_id", id),
  ]);
  const evidence = (evidenceLinks ?? []).map((l) => (Array.isArray(l.evidence) ? l.evidence[0] : l.evidence)).filter((e): e is { id: string; title: string; status: string; kind: string } => Boolean(e));
  const EVIDENCE_TONE: Record<string, string> = { current: "bg-emerald-100 text-emerald-800", expiring: "bg-amber-100 text-amber-800", expired: "bg-red-100 text-red-700", superseded: "bg-slate-200 text-slate-600", withdrawn: "bg-slate-200 text-slate-600" };
  const today = new Date().toISOString().slice(0, 10);
  const overdue = isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today);
  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <span className="capitalize" key="s">{task.status.replaceAll("_", " ")}</span>],
    ["Owner", owner?.display_name ?? "Unassigned"],
    ["Due date", <>{task.due_on ?? "—"}{overdue && <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span>}</>],
    ["Recurrence", <span className="capitalize" key="r">{task.recurrence ?? "One-off"}</span>],
    ["Source", <span className="capitalize" key="src">{task.source.replaceAll("_", " ")}</span>],
    ["Linked control", control ? <Link href="/app/soa" className="text-blue-700 hover:underline">{control.code}: {control.title}</Link> : "—"],
    ["Linked risk", risk ? <Link href="/app/risks" className="text-blue-700 hover:underline">{risk.reference}: {risk.title}</Link> : "—"],
  ];
  return <>
    <Link href="/app/tasks" className="text-sm text-blue-700 hover:underline">← Back to tasks</Link>
    <h1 className="mt-3 text-3xl font-bold">{task.title}</h1>
    <dl className="mt-8 grid gap-4 rounded-xl border bg-white p-6 sm:grid-cols-2">
      {facts.map(([label, value]) => <div key={label}><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}
    </dl>
    {task.detail && <section className="mt-6 rounded-xl border bg-white p-6"><h2 className="text-sm text-slate-500">Detail</h2><p className="mt-1 whitespace-pre-wrap">{task.detail}</p></section>}
    {evidence.length > 0 && <section className="mt-6 rounded-xl border bg-white p-6"><h2 className="text-sm text-slate-500">Linked evidence</h2><ul className="mt-2 space-y-2">{evidence.map((e) => <li key={e.id} className="flex items-center justify-between gap-3"><Link href="/app/evidence" className="text-blue-700 hover:underline">{e.title}</Link><span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${EVIDENCE_TONE[e.status] ?? "bg-slate-200 text-slate-600"}`}>{e.status}</span></li>)}</ul></section>}
    <form action={updateTaskStatusAction} className="mt-6 flex items-center gap-3">
      <input type="hidden" name="id" value={task.id} />
      <label className="text-sm font-medium">Update status<select name="status" defaultValue={task.status} className="ml-2 rounded border px-2 py-1"><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
      <button className="rounded bg-blue-600 px-4 py-2 text-sm text-white">Save</button>
    </form>
  </>;
}
