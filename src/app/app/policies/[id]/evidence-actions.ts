"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { hasCapability } from "@/features/organisations/domain/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";

async function requirePolicyEvidenceManager() {
  const context = await requireAppContext();
  if (!hasCapability(context.membership.role, "manage_policies")) {
    throw new Error("Only workspace operators can manage policy evidence");
  }
  return context;
}

export async function linkPolicyEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requirePolicyEvidenceManager();
  const policyId = z.uuid().parse(String(formData.get("policyId")));
  const evidenceId = z.uuid().parse(String(formData.get("evidenceId")));
  await enforceRateLimit(`policy-evidence:${organisation.id}:${user.id}:${policyId}`, { limit: 30, windowMs: 60_000 });
  const [{ data: policy }, { data: evidence }] = await Promise.all([
    supabase.from("policies").select("id").eq("id", policyId).eq("organisation_id", organisation.id).maybeSingle(),
    supabase.from("evidence").select("id").eq("id", evidenceId).eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  if (!policy || !evidence) throw new Error("Policy or evidence not found in the active workspace");
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: evidenceId, policy_id: policyId, created_by: user.id,
  });
  if (error) throw new Error("Could not link the evidence");
  revalidatePath(`/app/policies/${policyId}`);
}

export async function unlinkPolicyEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requirePolicyEvidenceManager();
  const policyId = z.uuid().parse(String(formData.get("policyId")));
  const linkId = z.uuid().parse(String(formData.get("linkId")));
  await enforceRateLimit(`policy-evidence:${organisation.id}:${user.id}:${policyId}`, { limit: 30, windowMs: 60_000 });
  const { data: link } = await supabase.from("evidence_links").select("id").eq("id", linkId).eq("organisation_id", organisation.id).eq("policy_id", policyId).maybeSingle();
  if (!link) throw new Error("Evidence link was not found in this policy");
  const { error } = await supabase.from("evidence_links").delete().eq("id", linkId).eq("organisation_id", organisation.id).eq("policy_id", policyId);
  if (error) throw new Error("Could not remove the evidence link");
  revalidatePath(`/app/policies/${policyId}`);
}
