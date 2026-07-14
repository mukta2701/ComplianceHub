"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { hasCapability } from "@/features/organisations/domain/access";

async function requirePolicyEvidenceManager() {
  const context = await requireAppContext();
  if (!hasCapability(context.membership.role, "manage_policies")) {
    throw new Error("Only workspace operators can manage policy evidence");
  }
  return context;
}

export async function linkPolicyEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requirePolicyEvidenceManager();
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
  const { supabase } = await requirePolicyEvidenceManager();
  const policyId = String(formData.get("policyId"));
  const { error } = await supabase.from("evidence_links").delete().eq("id", String(formData.get("linkId"))); if (error) throw new Error("Could not remove the evidence link");
  revalidatePath(`/app/policies/${policyId}`);
}
