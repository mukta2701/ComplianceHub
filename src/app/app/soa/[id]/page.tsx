import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { finaliseSoaAction, reviewSoaItemAction } from "../../actions";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { SOA_STATUS_LABEL } from "@/features/soa/domain/soa";
import { PageIntro, Pill } from "@/components/ui";

const CONTROL_STYLE: React.CSSProperties = { border: "1px solid #dbe0e8", borderRadius: "8px", padding: "9px 11px", fontSize: "13px", background: "#fff" };
const TEXTAREA_STYLE: React.CSSProperties = { ...CONTROL_STYLE, width: "100%", marginTop: "12px", minHeight: "84px", resize: "vertical" };

export default async function SoaReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: register } = await supabase.from("soa_registers").select("id,title,version").eq("id", id).single();
  if (!register) notFound();
  const { data: items } = await supabase.from("soa_items").select("id,control_id,control_code,control_title,applicable,status,justification,evidence,owner_id,position").eq("soa_register_id", id).order("position");
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
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
  return <><PageIntro eyebrow="SOA" title={register.title} body="Review every applicability decision and justification before finalising." action={<form action={finaliseSoaAction}><input type="hidden" name="registerId" value={id}/><button className="button primary">Finalise immutable v{register.version}</button></form>} /><div className="mt-8 space-y-4">{items?.map((item) => { const openTasks = openTasksByRequirement.get(item.control_id ?? "") ?? 0; const freshness = summariseEvidenceFreshness(evidenceByRequirement.get(item.control_id ?? "") ?? []); return <form action={reviewSoaItemAction} key={item.id} className="card" style={{ padding: "20px" }}><input type="hidden" name="itemId" value={item.id}/><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}><h2 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>{item.control_code}: {item.control_title}</h2><div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: "8px" }}>{freshness.total > 0 ? <Pill tone={freshness.expired > 0 ? "red" : freshness.expiring > 0 ? "amber" : "green"}>{freshness.total} evidence{freshness.expiring > 0 ? ` · ${freshness.expiring} expiring` : ""}{freshness.expired > 0 ? ` · ${freshness.expired} expired` : ""}</Pill> : <span style={{ fontSize: "12px", color: "#596273" }}>No evidence</span>}{openTasks > 0 ? <Link href="/app/tasks?filter=open" className="pill">{openTasks} open {openTasks === 1 ? "task" : "tasks"}</Link> : <span style={{ fontSize: "12px", color: "#596273" }}>No open tasks</span>}</div></div><div style={{ marginTop: "16px", display: "flex", gap: "12px", flexWrap: "wrap" }}><select name="status" defaultValue={item.status} style={CONTROL_STYLE}>{(["pending","absent","in_progress","established","operational","advanced","not_applicable"] as const).map((s) => <option key={s} value={s}>{SOA_STATUS_LABEL[s]}</option>)}</select><select name="ownerId" defaultValue={item.owner_id ?? ""} style={CONTROL_STYLE}><option value="">Unassigned owner</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select><select name="applicable" defaultValue={String(item.applicable)} style={CONTROL_STYLE}><option value="true">Applicable</option><option value="false">Not applicable</option></select></div><textarea name="justification" required defaultValue={item.justification} placeholder="Required justification" style={TEXTAREA_STYLE}/><textarea name="evidence" defaultValue={item.evidence} placeholder="Evidence references" style={TEXTAREA_STYLE}/><button className="button primary" style={{ marginTop: "12px" }}>Save review</button></form>; })}</div></>;
}
