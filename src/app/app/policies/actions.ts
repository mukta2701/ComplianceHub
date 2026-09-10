"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { policyInputSchema } from "@/features/policies/application/policy";
import { hasCapability } from "@/features/organisations/domain/access";
import { z } from "zod";

const policyConflict = "This policy changed while you were editing it. Refresh and try again.";

function expectedPolicyState(formData: FormData) {
  const id = z.uuid().parse(formData.get("id"));
  const version = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(formData.get("expectedVersion"));
  const revision = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(formData.get("expectedRevision"));
  return { id, version, revision };
}

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
  const { id, version: expectedVersion, revision: expectedRevision } = expectedPolicyState(formData);
  const parsed = policyInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data: current, error: readError } = await supabase.from("policies").select("version,edit_revision").eq("id", id).eq("organisation_id", organisation.id).single();
  if (readError) throw new Error("Could not load the policy before saving");
  if (!current) throw new Error("Policy not found");
  if (current.version !== expectedVersion || current.edit_revision !== expectedRevision) throw new Error(policyConflict);
  const { data: updated, error } = await supabase.from("policies").update({
    reference: parsed.reference, title: parsed.title, body: parsed.body,
    ...(formData.has("ownerId") ? { owner_id: parsed.ownerId } : {}),
    review_due: parsed.reviewDue, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("organisation_id", organisation.id).eq("version", expectedVersion).eq("edit_revision", expectedRevision).select("version,edit_revision").maybeSingle();
  if (error) throw new Error("Could not update the policy");
  if (!updated) throw new Error(policyConflict);
  let notificationFailed = false;
  if (updated.version !== expectedVersion) {
    try {
      const { error: notifyError } = await supabase.rpc("notify_policy_reaccept", { target_policy_id: id, note: `Now at version ${updated.version}.` });
      notificationFailed = Boolean(notifyError);
    } catch {
      // The policy write already committed; a notification transport error
      // must not discard its confirmed revision or imply the save failed.
      notificationFailed = true;
    }
  }
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
  return { version: updated.version, revision: updated.edit_revision, ...(notificationFailed ? { notificationFailed: true } : {}) };
}

export async function approvePolicyAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requirePolicyManager(membership.role);
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const { id, version, revision } = expectedPolicyState(formData);
  const { data, error } = await supabase.from("policies").update({
    status: "approved", approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("organisation_id", organisation.id).eq("version", version).eq("edit_revision", revision).select("id").maybeSingle();
  if (error) throw new Error("Could not approve the policy");
  if (!data) throw new Error(policyConflict);
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function setPolicyStatusAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requirePolicyManager(membership.role);
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const { id, version, revision } = expectedPolicyState(formData);
  const status = String(formData.get("status"));
  if (!["draft", "in_review", "archived"].includes(status)) throw new Error("Invalid policy status");
  const { data, error } = await supabase.from("policies").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", organisation.id).eq("version", version).eq("edit_revision", revision).select("id").maybeSingle();
  if (error) throw new Error("Could not update the policy status");
  if (!data) throw new Error(policyConflict);
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function acceptPolicyAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = z.uuid().parse(formData.get("id"));
  const expectedVersion = z.coerce.number().int().positive().max(2_147_483_647).parse(formData.get("expectedVersion"));
  const { data: policy, error: policyError } = await supabase.from("policies").select("id").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (policyError || !policy) throw new Error("Policy not found");
  const { error } = await supabase.rpc("accept_policy", { target_policy_id: id, expected_version: expectedVersion });
  if (error?.code === "22023" && error.message?.includes("policy version changed")) throw new Error("This policy changed. Refresh and read the current version before accepting it.");
  if (error) throw new Error("Could not record your acceptance");
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}
