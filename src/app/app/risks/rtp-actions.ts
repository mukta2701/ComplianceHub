"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { rtpInputSchema } from "@/features/risks/application/rtp";

export async function createRtpAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role === "member") throw new Error("Only workspace operators can create treatment plans");
  await enforceRateLimit(`rtp:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = rtpInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data, error } = await supabase.rpc("create_treatment_with_task", {
    target_organisation_id: organisation.id,
    plan_input: {
      risk_id: parsed.riskId, reference: parsed.reference, summary: parsed.summary,
      treatment_measures: parsed.treatmentMeasures, control_id: parsed.controlId, assigned_lead_id: parsed.assignedLeadId,
      target_completion: parsed.targetCompletion, status: parsed.status, spawn_task: parsed.spawnTask,
    },
  });
  if (error || !data) throw new Error("Could not save the treatment plan");
  revalidatePath(`/app/risks/${parsed.riskId}`); revalidatePath("/app/tasks");
  redirect(`/app/risks/${parsed.riskId}`);
}

export async function updateRtpStatusAction(formData: FormData) {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") throw new Error("Only workspace operators can update treatment plans");
  const status = String(formData.get("status"));
  if (!["planned", "in_progress", "completed", "cancelled"].includes(status)) throw new Error("Invalid RTP status");
  const riskId = String(formData.get("riskId"));
  const id = String(formData.get("id"));
  const { data: current, error: readError } = await supabase.from("risk_treatment_plans")
    .select("id,status,actual_completion").eq("id", id).eq("risk_id", riskId).eq("organisation_id", organisation.id).maybeSingle();
  if (readError || !current) throw new Error("Treatment plan not found");
  const patch = {
    status, updated_at: new Date().toISOString(),
    actual_completion: status === "completed" ? current.actual_completion ?? new Date().toISOString().slice(0, 10) : null,
  };
  const { data: updated, error } = await supabase.from("risk_treatment_plans").update(patch)
    .eq("id", id).eq("risk_id", riskId).eq("organisation_id", organisation.id).eq("status", current.status).select("id").maybeSingle();
  if (error || !updated) throw new Error("Could not update the treatment plan. Reload and try again.");
  revalidatePath(`/app/risks/${riskId}`);
}

export async function deleteRtpAction(formData: FormData) {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") throw new Error("Only workspace operators can delete treatment plans");
  const riskId = String(formData.get("riskId"));
  const { data, error } = await supabase.from("risk_treatment_plans").delete().eq("id", String(formData.get("id"))).eq("risk_id", riskId).eq("organisation_id", organisation.id).select("id").maybeSingle();
  if (error || !data) throw new Error("Could not delete the treatment plan");
  revalidatePath(`/app/risks/${riskId}`);
}
