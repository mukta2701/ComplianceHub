import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";

export default async function AppHome() {
  const { supabase, organisation } = await requireAppContext();
  const [{ count: assessments }, { count: risks }, { count: snapshots }, { data: activity }] = await Promise.all([
    supabase.from("assessment_sessions").select("id", { count: "exact", head: true }),
    supabase.from("risks").select("id", { count: "exact", head: true }).neq("status", "closed"),
    supabase.from("soa_snapshots").select("id", { count: "exact", head: true }),
    supabase.from("audit_events").select("id,action,entity_type,occurred_at").order("occurred_at", { ascending: false }).limit(5),
  ]);
  return <main className="mx-auto max-w-6xl px-6 py-12">
    <p className="text-sm font-medium text-blue-700">{organisation.name}</p><h1 className="mt-2 text-3xl font-bold">Readiness dashboard</h1>
    <div className="mt-8 grid gap-4 sm:grid-cols-3">{[["Assessments",assessments,"/app/assessment"],["Open risks",risks,"/app/risks"],["Finalised SoAs",snapshots,"/app/soa"]].map(([label,value,href]) => <Link key={label} href={String(href)} className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold">{value ?? 0}</p></Link>)}</div>
    <h2 className="mt-10 text-xl font-semibold">Recent activity</h2><div className="mt-3 divide-y rounded-xl border bg-white">{activity?.length ? activity.map((event) => <p className="p-4 text-sm" key={event.id}><b className="capitalize">{event.action}</b> {event.entity_type.replaceAll("_"," ")} <span className="float-right text-slate-500">{new Date(event.occurred_at).toLocaleString("en-GB")}</span></p>) : <p className="p-4 text-slate-500">No recorded activity yet.</p>}</div>
  </main>;
}
