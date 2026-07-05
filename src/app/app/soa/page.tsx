import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { createSoaAction } from "../actions";

export default async function SoaPage() { const { supabase } = await requireAppContext(); const [{ data: assessments }, { data: registers }, { data: snapshots }] = await Promise.all([supabase.from("assessment_sessions").select("id,title").order("updated_at", { ascending: false }), supabase.from("soa_registers").select("id,title,version,updated_at").order("updated_at", { ascending: false }), supabase.from("soa_snapshots").select("id,title,version,finalised_at").order("finalised_at", { ascending: false })]);
 return <><h1 className="text-3xl font-bold">Statement of Applicability</h1><form action={createSoaAction} className="mt-6 flex gap-3 rounded-xl border bg-white p-4"><select name="assessmentId" required className="flex-1 rounded border px-3"><option value="">Select an assessment</option>{assessments?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select><button className="rounded bg-blue-600 px-4 py-2 text-white">Generate draft</button></form>
 <h2 className="mt-9 text-xl font-semibold">Drafts</h2><div className="mt-3 divide-y rounded-xl border bg-white">{registers?.map((r) => <Link href={`/app/soa/${r.id}`} key={r.id} className="block p-4">{r.title} <span className="float-right">v{r.version}</span></Link>)}</div>
 <h2 className="mt-9 text-xl font-semibold">Finalised snapshots</h2><div className="mt-3 divide-y rounded-xl border bg-white">{snapshots?.map((s) => <div className="p-4" key={s.id}>{s.title} v{s.version}<span className="float-right space-x-3"><a className="text-blue-600" href={`/api/app/soa/${s.id}/pdf`}>PDF</a><a className="text-blue-600" href={`/api/app/soa/${s.id}/docx`}>DOCX</a></span></div>)}</div></>;
}
