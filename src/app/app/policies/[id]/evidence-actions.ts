"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";

export async function linkPolicyEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const policyId = String(formData.get("policyId"));
  const evidenceId = String(formData.get("evidenceId"));
  if (!evidenceId) throw new Error("Choose an evidence record to link");
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: evidenceId, policy_id: policyId, created_by: user.id,
  });
  if (error) throw new Error("Could not link the evidence");
  revalidatePath(`/app/policies/${policyId}`);
}

export async function unlinkPolicyEvidenceAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const policyId = String(formData.get("policyId"));
  await supabase.from("evidence_links").delete().eq("id", String(formData.get("linkId")));
  revalidatePath(`/app/policies/${policyId}`);
}
