"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageMembership, hasCapability, membershipRoles, type MembershipRole } from "@/features/organisations/domain/access";
import { requireAppContext } from "@/lib/app-context";

// Team lifecycle is guarded in both layers: Owners may manage every role,
// Admins only ordinary Members, and the database retains the final Owner.
export async function changeMemberRoleAction(formData: FormData) {
  const { supabase, membership, organisation } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_owners")) throw new Error("Only workspace owners can change roles");
  const userId = String(formData.get("userId"));
  const parsedRole = z.enum(membershipRoles).safeParse(formData.get("role"));
  if (!parsedRole.success) throw new Error("Invalid role");
  const role = parsedRole.data;
  const { error } = await supabase.from("memberships").update({ role }).eq("organisation_id", organisation.id).eq("user_id", userId);
  if (error) throw new Error(error.message.includes("at least one owner") ? "An organisation must keep at least one owner." : "Could not change the member's role");
  revalidatePath("/app/settings");
}

export async function updateMemberJobTitleAction(formData: FormData) {
  const { supabase, membership, organisation } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_members")) throw new Error("You are not allowed to manage team members");
  const userId = String(formData.get("userId"));
  const { data: target, error: readError } = await supabase.from("memberships").select("role")
    .eq("organisation_id", organisation.id).eq("user_id", userId).maybeSingle();
  if (readError || !target || !canManageMembership(membership.role, target.role as MembershipRole)) {
    throw new Error("You are not allowed to manage that team member");
  }
  const parsed = z.string().trim().max(120).safeParse(formData.get("jobTitle"));
  if (!parsed.success) throw new Error("Job title must be 120 characters or fewer");
  const { error } = await supabase.from("memberships").update({ job_title: parsed.data || null })
    .eq("organisation_id", organisation.id).eq("user_id", userId);
  if (error) throw new Error("Could not update the member's job title");
  revalidatePath("/app/settings");
}

export async function removeMemberAction(formData: FormData) {
  const { supabase, membership, organisation } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_members")) throw new Error("You are not allowed to manage team members");
  const userId = String(formData.get("userId"));
  const { data: target, error: readError } = await supabase.from("memberships").select("role")
    .eq("organisation_id", organisation.id).eq("user_id", userId).maybeSingle();
  if (readError || !target || !canManageMembership(membership.role, target.role as MembershipRole)) {
    throw new Error("You are not allowed to manage that team member");
  }
  const { error } = await supabase.from("memberships").delete().eq("organisation_id", organisation.id).eq("user_id", userId);
  if (error) throw new Error(error.message.includes("at least one owner") ? "An organisation must keep at least one owner." : "Could not remove the member");
  revalidatePath("/app/settings");
}
