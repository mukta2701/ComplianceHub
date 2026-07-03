import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { downloadEvidenceAction, linkEvidenceAction, unlinkEvidenceAction, withdrawEvidenceAction } from "./actions";

const TONE: Record<string, string> = { current: "bg-emerald-100 text-emerald-800", expiring: "bg-amber-100 text-amber-800", expired: "bg-red-100 text-red-700", superseded: "bg-slate-200 text-slate-600", withdrawn: "bg-slate-200 text-slate-600" };

export default async function EvidencePage() {
  const { supabase } = await requireAppContext();
  const [{ data: items }, { data: controls }] = await Promise.all([
    supabase.from("evidence").select("id,title,kind,url,storage_path,status,collected_on,valid_until,evidence_links(id,control_id,risk_id,task_id,controls(code,title),risks(reference),tasks(title))").order("created_at", { ascending: false }),
    supabase.from("controls").select("id,code,title").order("position"),
  ]);
  return <main className="mx-auto max-w-6xl px-6 py-10">
    <div className="flex justify-between"><div><h1 className="text-3xl font-bold">Evidence vault</h1><p className="mt-2 text-slate-600">Attach proof to controls, risks, and tasks — freshness is tracked daily.</p></div><Link href="/app/evidence/new" className="rounded bg-blue-600 px-4 py-2 text-white">Add evidence</Link></div>
    <div className="mt-8 space-y-4">{items?.map((item) => <section key={item.id} className="rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">{item.title}</h2><p className="text-sm text-slate-500">Collected {item.collected_on}{item.valid_until && ` · valid until ${item.valid_until}`}</p></div>
        <div className="flex items-center gap-3"><span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${TONE[item.status]}`}>{item.status}</span>
          {item.kind === "link" && item.url && <a className="text-sm text-blue-700" href={item.url} rel="noreferrer" target="_blank">Open link</a>}
          {item.kind === "file" && <form action={downloadEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="text-sm text-blue-700">Download</button></form>}
          {(item.status === "current" || item.status === "expiring" || item.status === "expired") && <><Link className="text-sm text-blue-700" href={`/app/evidence/new?replaces=${item.id}`}>Supersede</Link><form action={withdrawEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="text-sm text-red-700">Withdraw</button></form></>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {item.evidence_links?.map((link) => { const c = Array.isArray(link.controls) ? link.controls[0] : link.controls; const r = Array.isArray(link.risks) ? link.risks[0] : link.risks; const t = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks; return <span key={link.id} className="inline-flex items-center gap-1 rounded-full border px-3 py-1">{c ? `${c.code}: ${c.title}` : r ? `Risk ${r.reference}` : `Task: ${t?.title}`}<form action={unlinkEvidenceAction}><input type="hidden" name="linkId" value={link.id} /><button aria-label="Remove link" className="text-slate-400">×</button></form></span>; })}
        <form action={linkEvidenceAction} className="inline-flex items-center gap-2"><input type="hidden" name="evidenceId" value={item.id} /><select name="target" defaultValue="" aria-label={`Link ${item.title} to a control`} className="rounded border px-2 py-1"><option value="" disabled>Link to control…</option>{controls?.map((c) => <option key={c.id} value={`control:${c.id}`}>{c.code}: {c.title}</option>)}</select><button className="text-blue-700">Link</button></form>
      </div>
    </section>)}
    {!items?.length && <p className="mt-8 rounded-xl border bg-white p-6 text-slate-500">No evidence yet. Add your first item to start tracking freshness.</p>}
    </div>
  </main>;
}
