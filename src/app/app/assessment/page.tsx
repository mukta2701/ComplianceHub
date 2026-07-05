import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { createAssessmentAction } from "../actions";

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { supabase } = await requireAppContext(); const { message } = await searchParams;
  const { data } = await supabase.from("assessment_sessions").select("id,title,state,revision,updated_at").order("updated_at", { ascending: false });
  return <><div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold">Readiness assessments</h1><p className="mt-2 text-slate-600">Complete the original plain-English catalogue and retain evidence notes.</p></div><form action={createAssessmentAction}><button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">New assessment</button></form></div>
  {message && <p className="mt-5 rounded-lg bg-amber-50 p-3">{message}</p>}<div className="mt-8 divide-y rounded-xl border bg-white">{data?.length ? data.map((item) => <Link className="block p-5 hover:bg-slate-50" href={`/app/assessment/${item.id}`} key={item.id}><b>{item.title}</b><span className="float-right capitalize text-slate-500">{item.state} · revision {item.revision}</span></Link>) : <p className="p-6 text-slate-500">No assessments yet.</p>}</div></>;
}
