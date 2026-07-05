import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";

const STALE_EVIDENCE = new Set(["expired", "withdrawn", "superseded"]);

export default async function AppHome() {
  const { supabase, organisation } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);
  const [{ count: assessments }, { count: risks }, { count: snapshots }, { count: openTasks }, { count: liveEvidence }, { data: controls }, { data: activity }] = await Promise.all([
    supabase.from("assessment_sessions").select("id", { count: "exact", head: true }),
    supabase.from("risks").select("id", { count: "exact", head: true }).neq("status", "closed"),
    supabase.from("soa_snapshots").select("id", { count: "exact", head: true }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("evidence").select("id", { count: "exact", head: true }).in("status", ["current", "expiring", "expired"]),
    supabase.from("controls").select("id,code,title,evidence_links(evidence_id,evidence(status)),tasks(id,status,due_on)"),
    supabase.from("audit_events").select("id,action,entity_type,occurred_at").order("occurred_at", { ascending: false }).limit(5),
  ]);
  const attentionControls = (controls ?? []).flatMap((control) => {
    const statuses = (control.evidence_links ?? []).map((link) => {
      const ev = Array.isArray(link.evidence) ? link.evidence[0] : link.evidence;
      return ev?.status ?? null;
    });
    const staleEvidence = statuses.length > 0 && statuses.every((status) => status !== null && STALE_EVIDENCE.has(status));
    const overdueTask = (control.tasks ?? []).some((task) => isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today));
    if (!staleEvidence && !overdueTask) return [];
    const reasons: string[] = [];
    if (staleEvidence) reasons.push("linked evidence is out of date");
    if (overdueTask) reasons.push("a remediation task is overdue");
    return [{ id: control.id, code: control.code, title: control.title, reason: `— ${reasons.join(" and ")}` }];
  });
  return <>
    <p className="text-sm font-medium text-blue-700">{organisation.name}</p><h1 className="mt-2 text-3xl font-bold">Readiness dashboard</h1>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[["Assessments",assessments,"/app/assessment"],["Open risks",risks,"/app/risks"],["Finalised SoAs",snapshots,"/app/soa"],["Open tasks",openTasks,"/app/tasks"],["Evidence items",liveEvidence,"/app/evidence"]].map(([label,value,href]) => <Link key={label} href={String(href)} className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold">{value ?? 0}</p></Link>)}</div>
    {attentionControls.length > 0 && <section className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-xl font-semibold">Needs attention</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {attentionControls.slice(0, 5).map((control) => <li key={control.id}><Link className="text-blue-700 underline" href={`/app/soa?control=${control.id}`}>{control.code}: {control.title}</Link> <span className="text-slate-500">{control.reason}</span></li>)}
      </ul>
    </section>}
    <h2 className="mt-10 text-xl font-semibold">Recent activity</h2><div className="mt-3 divide-y rounded-xl border bg-white">{activity?.length ? activity.map((event) => <p className="p-4 text-sm" key={event.id}><b className="capitalize">{event.action}</b> {event.entity_type.replaceAll("_"," ")} <span className="float-right text-slate-500">{new Date(event.occurred_at).toLocaleString("en-GB")}</span></p>) : <p className="p-4 text-slate-500">No recorded activity yet.</p>}</div>
  </>;
}
