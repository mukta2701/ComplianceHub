"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { auditInputSchema, checklistItemInputSchema, findingInputSchema } from "@/features/audits/application/audit";

export async function createAuditAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
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
  const { supabase, user } = await requireAppContext();
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["planned", "in_progress", "reporting", "closed"].includes(status)) throw new Error("Invalid audit status");
  const { error } = await supabase.from("audits").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the audit status");
  revalidatePath(`/app/audits/${id}`);
}

export async function addChecklistItemAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = checklistItemInputSchema.parse(Object.fromEntries(formData));
  const { data: last } = await supabase.from("audit_checklist_items").select("position").eq("audit_id", parsed.auditId).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("audit_checklist_items").insert({
    organisation_id: organisation.id, audit_id: parsed.auditId, area: parsed.area, clause_reference: parsed.clauseReference,
    checklist_item: parsed.checklistItem, control_id: parsed.controlId, compliant: parsed.compliant,
    evidence_note: parsed.evidenceNote, findings: parsed.findings, responsible_id: parsed.responsibleId,
    reviewed_on: parsed.reviewedOn, position: (last?.position ?? -1) + 1,
  });
  if (error) throw new Error("Could not add the checklist item");
  revalidatePath(`/app/audits/${parsed.auditId}`);
}

export async function updateChecklistItemAction(formData: FormData) {
  const { supabase, user } = await requireAppContext();
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const auditId = String(formData.get("auditId"));
  const compliant = String(formData.get("compliant"));
  if (!["compliant", "non_compliant", "not_applicable", "not_tested"].includes(compliant)) throw new Error("Invalid result");
  const { error } = await supabase.from("audit_checklist_items").update({
    compliant, evidence_note: String(formData.get("evidenceNote") ?? ""), findings: String(formData.get("findings") ?? ""),
    reviewed_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Could not update the checklist item");
  revalidatePath(`/app/audits/${auditId}`);
}

export async function raiseFindingAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = findingInputSchema.parse(Object.fromEntries(formData));
  const { data: finding, error } = await supabase.from("audit_findings").insert({
    organisation_id: organisation.id, audit_id: parsed.auditId, checklist_item_id: parsed.checklistItemId,
    summary: parsed.summary, severity: parsed.severity, root_cause: parsed.rootCause,
    corrective_action: parsed.correctiveAction, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error("Could not raise the finding");
  // Spawn a corrective-action task through the existing tasks engine (source 'audit').
  if (parsed.spawnTask && parsed.correctiveAction) {
    const { data: task, error: taskError } = await supabase.from("tasks").insert({
      organisation_id: organisation.id, title: `Corrective action: ${parsed.summary}`.slice(0, 200),
      detail: parsed.correctiveAction, owner_id: parsed.ownerId, due_on: parsed.dueOn,
      source: "audit", created_by: user.id,
    }).select("id").single();
    if (taskError) throw new Error("Raised the finding but could not create its task");
    const { error: linkError } = await supabase.from("audit_findings").update({ task_id: task.id, status: "in_progress" }).eq("id", finding.id);
    if (linkError) throw new Error("Created the task but could not link it to the finding");
  }
  revalidatePath(`/app/audits/${parsed.auditId}`); revalidatePath("/app/tasks");
}

export async function updateFindingStatusAction(formData: FormData) {
  const { supabase, user } = await requireAppContext();
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const auditId = String(formData.get("auditId"));
  const status = String(formData.get("status"));
  if (!["open", "in_progress", "closed"].includes(status)) throw new Error("Invalid finding status");
  const { error } = await supabase.from("audit_findings").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the finding");
  revalidatePath(`/app/audits/${auditId}`);
}

export async function linkChecklistEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const auditId = String(formData.get("auditId"));
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: String(formData.get("evidenceId")),
    audit_checklist_item_id: String(formData.get("checklistItemId")), created_by: user.id,
  });
  if (error) throw new Error("Could not link the evidence");
  revalidatePath(`/app/audits/${auditId}`);
}
