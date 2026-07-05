"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { rtpInputSchema } from "@/features/risks/application/rtp";

export async function createRtpAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`rtp:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = rtpInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("risk_treatment_plans").insert({
    organisation_id: organisation.id, risk_id: parsed.riskId, reference: parsed.reference, summary: parsed.summary,
    treatment_measures: parsed.treatmentMeasures, control_id: parsed.controlId, assigned_lead_id: parsed.assignedLeadId,
    target_completion: parsed.targetCompletion, status: parsed.status, created_by: user.id,
  });
  if (error) throw new Error("Could not save the treatment plan");
  // Optionally spawn a task through the existing tasks engine (source risk_treatment).
  if (parsed.spawnTask) {
    const { error: taskError } = await supabase.from("tasks").insert({
      organisation_id: organisation.id, title: `Treatment plan ${parsed.reference}`,
      detail: parsed.treatmentMeasures || parsed.summary, owner_id: parsed.assignedLeadId,
      due_on: parsed.targetCompletion, source: "risk_treatment", control_id: parsed.controlId,
      risk_id: parsed.riskId, created_by: user.id,
    });
    if (taskError) throw new Error("Saved the plan but could not create its task");
  }
  revalidatePath(`/app/risks/${parsed.riskId}`); revalidatePath("/app/tasks");
  redirect(`/app/risks/${parsed.riskId}`);
}

export async function updateRtpStatusAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const status = String(formData.get("status"));
  if (!["planned", "in_progress", "completed", "cancelled"].includes(status)) throw new Error("Invalid RTP status");
  const riskId = String(formData.get("riskId"));
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "completed") patch.actual_completion = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("risk_treatment_plans").update(patch).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not update the treatment plan");
  revalidatePath(`/app/risks/${riskId}`);
}

export async function deleteRtpAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const riskId = String(formData.get("riskId"));
  await supabase.from("risk_treatment_plans").delete().eq("id", String(formData.get("id")));
  revalidatePath(`/app/risks/${riskId}`);
}
