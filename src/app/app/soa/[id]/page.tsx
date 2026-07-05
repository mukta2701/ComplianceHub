import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { finaliseSoaAction, reviewSoaItemAction } from "../../actions";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";

export default async function SoaReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: register } = await supabase.from("soa_registers").select("id,title,version").eq("id", id).single();
  if (!register) notFound();
  const { data: items } = await supabase.from("soa_items").select("id,control_id,control_code,control_title,applicable,status,justification,evidence,position").eq("soa_register_id", id).order("position");
  // Map each requirement (soa_items.control_id) through the shared control library
  // to count open tasks that address it.
  const requirementIds = (items ?? []).map((i) => i.control_id).filter((v): v is string => Boolean(v));
  const openTasksByRequirement = new Map<string, number>();
  // Freshness of evidence linked to each requirement, mapped through the shared control library.
  const evidenceByRequirement = new Map<string, { status: EvidenceStatus }[]>();
  if (requirementIds.length) {
    const { data: mappings } = await supabase.from("requirement_control_mappings").select("requirement_id,control_id").in("requirement_id", requirementIds);
    const sharedControlIds = [...new Set((mappings ?? []).map((m) => m.control_id))];
    const openCountByControl = new Map<string, number>();
    const evidenceByControl = new Map<string, { status: EvidenceStatus }[]>();
    if (sharedControlIds.length) {
      const [{ data: tasks }, { data: links }] = await Promise.all([
        supabase.from("tasks").select("id,control_id,status").in("status", ["open", "in_progress"]).in("control_id", sharedControlIds),
        supabase.from("evidence_links").select("control_id,evidence(status)").in("control_id", sharedControlIds),
      ]);
      for (const t of tasks ?? []) { if (!t.control_id) continue; openCountByControl.set(t.control_id, (openCountByControl.get(t.control_id) ?? 0) + 1); }
      for (const link of links ?? []) {
        if (!link.control_id) continue;
        const ev = Array.isArray(link.evidence) ? link.evidence[0] : link.evidence;
        if (!ev) continue;
        const list = evidenceByControl.get(link.control_id) ?? [];
        list.push({ status: ev.status as EvidenceStatus });
        evidenceByControl.set(link.control_id, list);
      }
    }
    for (const m of mappings ?? []) {
      openTasksByRequirement.set(m.requirement_id, (openTasksByRequirement.get(m.requirement_id) ?? 0) + (openCountByControl.get(m.control_id) ?? 0));
      const controlEvidence = evidenceByControl.get(m.control_id);
      if (controlEvidence?.length) {
        const list = evidenceByRequirement.get(m.requirement_id) ?? [];
        list.push(...controlEvidence);
        evidenceByRequirement.set(m.requirement_id, list);
      }
    }
  }
  return <><div className="flex justify-between"><div><h1 className="text-3xl font-bold">{register.title}</h1><p className="mt-2 text-slate-600">Review every applicability decision and justification before finalising.</p></div><form action={finaliseSoaAction}><input type="hidden" name="registerId" value={id}/><button className="rounded bg-emerald-700 px-4 py-2 text-white">Finalise immutable v{register.version}</button></form></div><div className="mt-8 space-y-4">{items?.map((item) => { const openTasks = openTasksByRequirement.get(item.control_id ?? "") ?? 0; const freshness = summariseEvidenceFreshness(evidenceByRequirement.get(item.control_id ?? "") ?? []); return <form action={reviewSoaItemAction} key={item.id} className="rounded-xl border bg-white p-5"><input type="hidden" name="itemId" value={item.id}/><div className="flex items-center justify-between gap-4"><h2 className="font-semibold">{item.control_code}: {item.control_title}</h2><div className="flex shrink-0 items-center gap-2">{freshness.total > 0 ? <span className={`rounded-full px-3 py-1 text-xs font-medium ${freshness.expired > 0 ? "bg-red-50 text-red-700" : freshness.expiring > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{freshness.total} evidence{freshness.expiring > 0 ? ` · ${freshness.expiring} expiring` : ""}{freshness.expired > 0 ? ` · ${freshness.expired} expired` : ""}</span> : <span className="text-xs text-slate-400">No evidence</span>}{openTasks > 0 ? <Link href="/app/tasks?filter=open" className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{openTasks} open {openTasks === 1 ? "task" : "tasks"}</Link> : <span className="text-xs text-slate-400">No open tasks</span>}</div></div><div className="mt-4 flex gap-3"><select name="status" defaultValue={item.status} className="rounded border px-3 py-2"><option value="implemented">Implemented</option><option value="partial">Partial</option><option value="planned">Planned</option><option value="not_applicable">Not applicable</option></select><select name="applicable" defaultValue={String(item.applicable)} className="rounded border px-3 py-2"><option value="true">Applicable</option><option value="false">Not applicable</option></select></div><textarea name="justification" required defaultValue={item.justification} placeholder="Required justification" className="mt-3 w-full rounded border p-3"/><textarea name="evidence" defaultValue={item.evidence} placeholder="Evidence references" className="mt-3 w-full rounded border p-3"/><button className="mt-3 rounded bg-slate-900 px-4 py-2 text-white">Save review</button></form>; })}</div></>;
}
