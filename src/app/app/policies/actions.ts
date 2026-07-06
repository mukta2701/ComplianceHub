"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { policyInputSchema } from "@/features/policies/application/policy";
import { isMaterialPolicyEdit } from "@/features/policies/domain/policies";

export async function createPolicyAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
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
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const parsed = policyInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data: current, error: readError } = await supabase.from("policies").select("body,version,owner_id").eq("id", id).single();
  if (readError || !current) throw new Error("Policy not found");
  // A material edit bumps the version and fires the org-wide re-accept notification,
  // so editing is limited to a workspace owner or the policy's own owner. (RLS lets
  // any member update, and the notify RPC is only member-guarded server-side; this
  // action is the sanctioned edit path and gates who may reach it — Task 5 review.)
  if (membership.role !== "owner" && current.owner_id !== user.id) {
    throw new Error("Only workspace owners or the policy owner can edit this policy");
  }
  const material = isMaterialPolicyEdit(current.body ?? "", parsed.body);
  const nextVersion = material ? current.version + 1 : current.version;
  const { error } = await supabase.from("policies").update({
    reference: parsed.reference, title: parsed.title, body: parsed.body, owner_id: parsed.ownerId,
    review_due: parsed.reviewDue, version: nextVersion, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Could not update the policy");
  // A material edit invalidates prior acceptances (they were stamped at an older
  // version) and asks members to re-accept via the org-scoped RPC.
  if (material) {
    const { error: notifyError } = await supabase.rpc("notify_policy_reaccept", { target_policy_id: id, note: `Now at version ${nextVersion}.` });
    if (notifyError) throw new Error("Updated the policy but could not notify members to re-accept");
  }
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function approvePolicyAction(formData: FormData) {
  const { supabase, user, membership } = await requireAppContext();
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  if (membership.role !== "owner") throw new Error("Only workspace owners can approve policies");
  const id = String(formData.get("id"));
  const { error } = await supabase.from("policies").update({
    status: "approved", approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Could not approve the policy");
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function setPolicyStatusAction(formData: FormData) {
  const { supabase, user, membership } = await requireAppContext();
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  if (membership.role !== "owner") throw new Error("Only workspace owners can change a policy's status");
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["draft", "in_review", "approved", "archived"].includes(status)) throw new Error("Invalid policy status");
  const { error } = await supabase.from("policies").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the policy status");
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function acceptPolicyAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));
  if (!Number.isInteger(version) || version < 1) throw new Error("Invalid policy version");
  const { error } = await supabase.from("policy_acceptances").upsert({
    organisation_id: organisation.id, policy_id: id, user_id: user.id, accepted_version: version, accepted_at: new Date().toISOString(),
  }, { onConflict: "policy_id,user_id" });
  if (error) throw new Error("Could not record your acceptance");
  revalidatePath(`/app/policies/${id}`);
}
