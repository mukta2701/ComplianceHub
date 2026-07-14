"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { policyInputSchema } from "@/features/policies/application/policy";
import { hasCapability } from "@/features/organisations/domain/access";

function requirePolicyManager(role: "owner" | "admin" | "member") {
  if (!hasCapability(role, "manage_policies")) {
    throw new Error("Only workspace operators can manage policies");
  }
}

export async function createPolicyAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requirePolicyManager(membership.role);
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = policyInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data, error } = await supabase.from("policies").insert({
    organisation_id: organisation.id, reference: parsed.reference, title: parsed.title, body: parsed.body,
    owner_id: parsed.ownerId, review_due: parsed.reviewDue, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error("Could not create the policy");
  revalidatePath("/app/policies"); redirect(`/app/policies/${data.id}`);
}

export async function updatePolicyAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requirePolicyManager(membership.role);
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const expectedVersion = Number(formData.get("expectedVersion"));
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("Invalid expected policy version");
  const parsed = policyInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data: current, error: readError } = await supabase.from("policies").select("body,version,owner_id").eq("id", id).single();
  if (readError || !current) throw new Error("Policy not found");
  if (current.version !== expectedVersion) throw new Error("This policy changed while you were editing it. Refresh and try again.");
  const { data: updated, error } = await supabase.from("policies").update({
    reference: parsed.reference, title: parsed.title, body: parsed.body, owner_id: parsed.ownerId,
    review_due: parsed.reviewDue, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("version", expectedVersion).select("version").maybeSingle();
  if (error) throw new Error("Could not update the policy");
  if (!updated) throw new Error("This policy changed while you were editing it. Refresh and try again.");
  if (updated.version !== expectedVersion) {
    const { error: notifyError } = await supabase.rpc("notify_policy_reaccept", { target_policy_id: id, note: `Now at version ${updated.version}.` });
    if (notifyError) throw new Error("Updated the policy but could not notify members to re-accept");
  }
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function approvePolicyAction(formData: FormData) {
  const { supabase, user, membership } = await requireAppContext();
  requirePolicyManager(membership.role);
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const { error } = await supabase.from("policies").update({
    status: "approved", approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Could not approve the policy");
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function setPolicyStatusAction(formData: FormData) {
  const { supabase, user, membership } = await requireAppContext();
  requirePolicyManager(membership.role);
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["draft", "in_review", "approved", "archived"].includes(status)) throw new Error("Invalid policy status");
  const { error } = await supabase.from("policies").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the policy status");
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function acceptPolicyAction(formData: FormData) {
  const { supabase, user } = await requireAppContext();
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const { error } = await supabase.rpc("accept_policy", { target_policy_id: id });
  if (error) throw new Error("Could not record your acceptance");
  revalidatePath(`/app/policies/${id}`);
}
