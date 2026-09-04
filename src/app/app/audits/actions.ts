"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { auditInputSchema, checklistItemInputSchema, findingInputSchema } from "@/features/audits/application/audit";

function requireOperator(membership: { role: string }) {
  if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Only workspace operators can modify audits");
}

export async function createAuditAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireOperator(membership);
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = auditInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data, error } = await supabase.from("audits").insert({
    organisation_id: organisation.id, reference: parsed.reference, title: parsed.title, scope: parsed.scope,
    lead_auditor_id: parsed.leadAuditorId, planned_start: parsed.plannedStart, planned_end: parsed.plannedEnd,
    framework: parsed.framework, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error("Could not plan the audit");
  revalidatePath("/app/audits"); redirect(`/app/audits/${data.id}`);
}

export async function updateAuditStatusAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireOperator(membership);
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["planned", "in_progress", "reporting", "closed"].includes(status)) throw new Error("Invalid audit status");
  const { data, error } = await supabase.from("audits").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", organisation.id).select("id").maybeSingle();
  if (error) throw new Error("Could not update the audit status");
  if (!data) throw new Error("Audit not found");
  revalidatePath(`/app/audits/${id}`);
}

export async function addChecklistItemAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireOperator(membership);
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = checklistItemInputSchema.parse(Object.fromEntries(formData));
  const { data: last } = await supabase.from("audit_checklist_items").select("position").eq("audit_id", parsed.auditId).eq("organisation_id", organisation.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("audit_checklist_items").insert({
    organisation_id: organisation.id, audit_id: parsed.auditId, area: parsed.area, clause_reference: parsed.clauseReference,
    checklist_item: parsed.checklistItem, control_id: parsed.controlId, compliant: parsed.compliant,
    evidence_note: parsed.evidenceNote, findings: parsed.findings, responsible_id: parsed.responsibleId,
    reviewed_on: parsed.reviewedOn, position: (last?.position ?? -1) + 1,
  });
  if (error) throw new Error("Could not add the checklist item");
  revalidatePath(`/app/audits/${parsed.auditId}`);
}

export async function populateAuditChecklistAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireOperator(membership);
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const auditId = String(formData.get("auditId"));
  // Confirm the audit exists in the caller's org (read under RLS — never a
  // service role); a stranger's id simply reads back nothing.
  const { data: audit, error: auditError } = await supabase.from("audits").select("id").eq("id", auditId).eq("organisation_id", organisation.id).maybeSingle();
  if (auditError) throw new Error("Could not load that audit");
  if (!audit) throw new Error("Could not find that audit");
  // The Annex A control library is global (RLS: controls_read using(true)); the
  // audits module already reads it this way elsewhere.
  const [{ data: controls, error: controlsError }, { data: existing, error: existingError }] = await Promise.all([
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("audit_checklist_items").select("control_id,position").eq("audit_id", auditId).eq("organisation_id", organisation.id),
  ]);
  if (controlsError || existingError) throw new Error("Could not load the audit checklist");
  // Idempotency: skip any control that already has a row on this audit, so a
  // re-run only fills in the controls that are still missing.
  const seenControls = new Set((existing ?? []).map((r) => r.control_id).filter((c): c is string => !!c));
  let position = (existing ?? []).reduce((max, r) => Math.max(max, r.position), -1);
  const rows = (controls ?? [])
    .filter((c) => !seenControls.has(c.id))
    .map((c) => ({
      organisation_id: organisation.id, audit_id: auditId, control_id: c.id,
      area: "Annex A", clause_reference: c.code,
      checklist_item: `Is the control '${c.title}' implemented and operating effectively?`,
      compliant: "not_tested" as const, position: ++position,
    }));
  if (rows.length) {
    const { error } = await supabase.from("audit_checklist_items").insert(rows);
    if (error) throw new Error("Could not populate the checklist from the control library");
  }
  revalidatePath(`/app/audits/${auditId}`);
}

export async function updateChecklistItemAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireOperator(membership);
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const auditId = String(formData.get("auditId"));
  const compliant = String(formData.get("compliant"));
  if (!["compliant", "non_compliant", "not_applicable", "not_tested"].includes(compliant)) throw new Error("Invalid result");
  const { data, error } = await supabase.from("audit_checklist_items").update({
    compliant, evidence_note: String(formData.get("evidenceNote") ?? ""), findings: String(formData.get("findings") ?? ""),
    reviewed_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("organisation_id", organisation.id).eq("audit_id", auditId).select("id").maybeSingle();
  if (error) throw new Error("Could not update the checklist item");
  if (!data) throw new Error("Checklist item not found");
  revalidatePath(`/app/audits/${auditId}`);
}

export async function raiseFindingAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireOperator(membership);
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = findingInputSchema.parse(Object.fromEntries(formData));
  if (parsed.checklistItemId) {
    const { data: checklistItem, error: checklistError } = await supabase.from("audit_checklist_items")
      .select("id")
      .eq("id", parsed.checklistItemId)
      .eq("audit_id", parsed.auditId)
      .eq("organisation_id", organisation.id)
      .maybeSingle();
    if (checklistError || !checklistItem) throw new Error("Could not find that checklist item");
  }
  const { data: finding, error } = await supabase.rpc("raise_finding_with_task", {
    target_organisation_id: organisation.id,
    finding_input: {
      audit_id: parsed.auditId, checklist_item_id: parsed.checklistItemId, summary: parsed.summary,
      severity: parsed.severity, root_cause: parsed.rootCause, corrective_action: parsed.correctiveAction,
      owner_id: parsed.ownerId, due_on: parsed.dueOn, spawn_task: parsed.spawnTask,
    },
  });
  if (error) throw new Error("Could not raise the finding");
  if (!finding) throw new Error("Could not raise the finding");
  revalidatePath(`/app/audits/${parsed.auditId}`); revalidatePath("/app/tasks");
}

export async function updateFindingStatusAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireOperator(membership);
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const auditId = String(formData.get("auditId"));
  const status = String(formData.get("status"));
  if (!["open", "in_progress", "closed"].includes(status)) throw new Error("Invalid finding status");
  const { data, error } = await supabase.from("audit_findings").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", organisation.id).eq("audit_id", auditId).select("id").maybeSingle();
  if (error) throw new Error("Could not update the finding");
  if (!data) throw new Error("Finding not found");
  revalidatePath(`/app/audits/${auditId}`);
}

export async function linkChecklistEvidenceAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireOperator(membership);
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const auditId = String(formData.get("auditId"));
  const checklistItemId = String(formData.get("checklistItemId"));
  const { data: checklistItem, error: checklistError } = await supabase.from("audit_checklist_items")
    .select("id")
    .eq("id", checklistItemId)
    .eq("audit_id", auditId)
    .eq("organisation_id", organisation.id)
    .maybeSingle();
  if (checklistError || !checklistItem) throw new Error("Could not find that checklist item");
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: String(formData.get("evidenceId")),
    audit_checklist_item_id: checklistItemId, created_by: user.id,
  });
  if (error) throw new Error("Could not link the evidence");
  revalidatePath(`/app/audits/${auditId}`);
}
