"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOrganisation } from "@/features/organisations/application/organisation";
import { inviteMember } from "@/features/organisations/application/organisation";
import { riskInputSchema } from "@/features/risks/application/risk";
import { soaItemReviewSchema } from "@/features/soa/application/review";
import { collectSoaFinalisationBlockers, countSoaFinalisationBlockers } from "@/features/soa/application/finalisation";
import type { SoaStatus } from "@/features/soa/domain/soa";
import { clearActiveOrganisationCookie, requireAppContext, setActiveOrganisationCookie } from "@/lib/app-context";
import { one } from "@/lib/supabase/one";
import { revalidatePath } from "next/cache";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { z } from "zod";
import { canInviteRole, canManageMembership, hasCapability, membershipRoles, type MembershipRole } from "@/features/organisations/domain/access";

export async function createOrganisationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  let organisation: Awaited<ReturnType<typeof createOrganisation>>;
  try {
    organisation = await createOrganisation({ name: formData.get("name") }, {
      userId: user.id,
      insert: async ({ name, slug, createdBy }) => {
        const uniqueSlug = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
        void createdBy;
        const { data, error } = await supabase.rpc("create_organisation_with_owner", {
          organisation_name: name,
          organisation_slug: uniqueSlug,
        });
        if (error) throw error;
        return { id: String(data), name, slug: uniqueSlug };
      },
    });
  } catch {
    redirect(`/app/onboarding?message=${encodeURIComponent("Could not create the organisation. Check the name and try again.")}`);
  }

  // Selection happens after the database transaction has committed. A cookie
  // failure must surface as an operational error, not invite a duplicate retry.
  await setActiveOrganisationCookie(organisation.id);
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function switchWorkspaceAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const parsedOrganisationId = z.uuid().safeParse(formData.get("organisationId"));
  if (!parsedOrganisationId.success) throw new Error("Invalid workspace");

  const { data: membership, error } = await supabase.from("memberships")
    .select("organisation_id")
    .eq("user_id", user.id)
    .eq("organisation_id", parsedOrganisationId.data)
    .maybeSingle();
  if (error) throw new Error("Could not verify workspace membership");
  if (!membership) throw new Error("You are not a member of that workspace");

  await setActiveOrganisationCookie(parsedOrganisationId.data);
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("Could not sign out");
  await clearActiveOrganisationCookie();
  redirect("/");
}

export async function createAssessmentAction() {
  const { supabase, user, organisation } = await requireAppContext();
  const { data: catalogue } = await supabase.from("catalogue_versions").select("id").not("published_at", "is", null).order("published_at", { ascending: false }).limit(1).single();
  if (!catalogue) redirect("/app/assessment?message=No%20published%20catalogue%20is%20available.");
  const { data, error } = await supabase.from("assessment_sessions").insert({ organisation_id: organisation.id, catalogue_version_id: catalogue.id, title: `Readiness assessment ${new Date().toLocaleDateString("en-GB")}`, created_by: user.id }).select("id").single();
  if (error) redirect("/app/assessment?message=Could%20not%20create%20the%20assessment.");
  redirect(`/app/assessment/${data.id}`);
}

export async function createRiskAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`risk:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = riskInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("risks").insert({ organisation_id: organisation.id, reference: parsed.reference, title: parsed.title, description: parsed.description, category_id: parsed.categoryId, owner_id: parsed.ownerId || null, likelihood: parsed.likelihood, impact: parsed.impact, treatment: parsed.treatment, treatment_plan: parsed.treatmentPlan, residual_likelihood: parsed.residualLikelihood, residual_impact: parsed.residualImpact, review_date: parsed.reviewDate || null, status: parsed.status, evidence: parsed.evidence, source_assessment_session_id: parsed.sourceAssessmentSessionId || null, source_soa_register_id: parsed.sourceSoaRegisterId || null, created_by: user.id });
  if (error) throw new Error("Could not save risk");
  revalidatePath("/app/risks"); redirect("/app/risks");
}

export async function deleteRiskAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const { error } = await supabase.from("risks").delete().eq("id", String(formData.get("id"))); if (error) throw new Error("Could not delete the risk");
  revalidatePath("/app/risks");
}

export async function updateRiskStatusAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const status = String(formData.get("status")); if (!["open","treating","accepted","closed"].includes(status)) throw new Error("Invalid risk status");
  const { error } = await supabase.from("risks").update({ status }).eq("id", String(formData.get("id"))); if (error) throw new Error("Could not update risk");
  revalidatePath("/app/risks");
}

export async function acceptRiskSuggestionAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext(); const questionId=String(formData.get("questionId"));
  const { data: question } = await supabase.from("catalogue_questions").select("code,prompt,remediation,weight").eq("id", questionId).single(); if (!question) throw new Error("Suggestion not found");
  const { count }=await supabase.from("risks").select("id",{count:"exact",head:true}); const rating=Math.max(1,Math.min(5,Math.round(Number(question.weight))));
  const { data: readinessCat } = await supabase.from("risk_categories")
    .select("id").eq("name", "Readiness").maybeSingle();
  let categoryId = readinessCat?.id ?? null;
  if (!categoryId) {
    const { data: maxPos } = await supabase.from("risk_categories").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: created } = await supabase.from("risk_categories")
      .insert({ organisation_id: organisation.id, name: "Readiness", position: (maxPos?.position ?? -1) + 1 })
      .select("id").single();
    categoryId = created?.id ?? null;
  }
  const { error }=await supabase.from("risks").insert({ organisation_id:organisation.id,reference:`R-${String((count??0)+1).padStart(3,"0")}`,title:`Readiness gap: ${question.prompt}`,description:"This risk was accepted from an assessment gap and requires an owner review.",category_id:categoryId,likelihood:Math.min(5,rating+1),impact:rating,treatment:"mitigate",treatment_plan:question.remediation,residual_likelihood:rating,residual_impact:rating,status:"open",evidence:"",source_assessment_session_id:String(formData.get("sessionId")),created_by:user.id }); if(error) throw new Error("Could not accept risk suggestion"); revalidatePath("/app/risks");
}

export async function createSoaAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const assessmentId = String(formData.get("assessmentId"));
  const { data: registerId, error } = await supabase.rpc("create_soa_draft", {
    target_assessment_id: assessmentId,
    draft_title: "Statement of Applicability",
  });
  if (error) throw new Error("Could not create SoA");
  redirect(`/app/soa/${registerId}`);
}

export async function reviewSoaItemAction(formData: FormData) {
  const { supabase, organisation } = await requireAppContext();
  const parsed = soaItemReviewSchema.parse({ itemId: formData.get("itemId"), status: formData.get("status"), applicable: formData.get("applicable") === "true", justification: formData.get("justification"), evidence: formData.get("evidence") });
  const ownerId = String(formData.get("ownerId")) || null;
  const { data: updated, error } = await supabase
    .from("soa_items")
    .update({ status: parsed.status, applicable: parsed.applicable, justification: parsed.justification, evidence: parsed.evidence, owner_id: ownerId })
    .eq("id", parsed.itemId)
    .eq("organisation_id", organisation.id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not update SoA item");
  if (!updated) throw new Error("SoA item not found in the active workspace");
  revalidatePath("/app/soa");
}

export async function finaliseSoaAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`soa-finalise:${user.id}`, { limit: 5, windowMs: 60_000 });
  const requestedRegisterId = z.uuid().parse(formData.get("registerId"));
  const { data: register, error: registerError } = await supabase
    .from("soa_registers")
    .select("id")
    .eq("id", requestedRegisterId)
    .eq("organisation_id", organisation.id)
    .maybeSingle();
  if (registerError) throw new Error("Could not load SoA register");
  if (!register) throw new Error("SoA register not found");

  const { data: itemRows, error: itemError } = await supabase
    .from("soa_items")
    .select("id,control_id,applicable,status,justification,owner_id")
    .eq("soa_register_id", register.id)
    .eq("organisation_id", organisation.id);
  if (itemError) throw new Error("Could not load SoA finalisation preflight");

  const requirementIds = (itemRows ?? []).map((item) => item.control_id);
  const requirementIdsWithLiveEvidence = new Set<string>();
  const requirementIdsWithExpiredEvidence = new Set<string>();
  if (requirementIds.length) {
    const { data: mappings, error: mappingError } = await supabase
      .from("requirement_control_mappings")
      .select("requirement_id,control_id")
      .in("requirement_id", requirementIds);
    if (mappingError) throw new Error("Could not load SoA evidence mappings");

    const requirementIdsByControl = new Map<string, Set<string>>();
    for (const mapping of mappings ?? []) {
      const mappedRequirements = requirementIdsByControl.get(mapping.control_id) ?? new Set<string>();
      mappedRequirements.add(mapping.requirement_id);
      requirementIdsByControl.set(mapping.control_id, mappedRequirements);
    }

    const sharedControlIds = [...requirementIdsByControl.keys()];
    if (sharedControlIds.length) {
      const { data: evidenceLinks, error: evidenceError } = await supabase
        .from("evidence_links")
        .select("control_id,evidence(status)")
        .eq("organisation_id", organisation.id)
        .in("control_id", sharedControlIds);
      if (evidenceError) throw new Error("Could not load SoA evidence freshness");

      for (const link of evidenceLinks ?? []) {
        if (!link.control_id) continue;
        const evidence = one(link.evidence);
        const mappedRequirementIds = requirementIdsByControl.get(link.control_id) ?? [];
        if (evidence?.status === "expired") {
          for (const requirementId of mappedRequirementIds) requirementIdsWithExpiredEvidence.add(requirementId);
        }
        if (evidence?.status === "current" || evidence?.status === "expiring") {
          for (const requirementId of mappedRequirementIds) requirementIdsWithLiveEvidence.add(requirementId);
        }
      }
    }
  }

  for (const requirementId of requirementIdsWithExpiredEvidence) {
    requirementIdsWithLiveEvidence.delete(requirementId);
  }

  const blockers = collectSoaFinalisationBlockers((itemRows ?? []).map((item) => ({
    id: item.id,
    controlId: item.control_id,
    applicable: item.applicable,
    status: item.status as SoaStatus,
    justification: item.justification,
    ownerId: item.owner_id,
  })), requirementIdsWithLiveEvidence);
  if (countSoaFinalisationBlockers(blockers) > 0) {
    const details = [
      blockers.pending.length ? `${blockers.pending.length} pending` : null,
      blockers.missingRationale.length ? `${blockers.missingRationale.length} missing rationale` : null,
      blockers.unassigned.length ? `${blockers.unassigned.length} unassigned` : null,
      blockers.missingEvidence.length ? `${blockers.missingEvidence.length} missing live evidence` : null,
    ].filter(Boolean).join(", ");
    throw new Error(`SoA cannot be finalised: ${details}`);
  }

  const { data, error } = await supabase.rpc("finalise_soa", { target_register_id: register.id });
  if (error) throw new Error(error.message);
  redirect(`/app/soa?finalised=${data}`);
}

export async function inviteMemberAction(formData: FormData) {
  const { supabase, user, membership, organisation } = await requireAppContext();
  await enforceRateLimit(`invite:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  const result = await inviteMember({ organisationId: organisation.id, email: formData.get("email"), role: formData.get("role"), jobTitle: formData.get("jobTitle") || undefined }, { actorId: user.id, actorRole: membership.role, insertInvitation: async (row) => {
    const { data, error } = await supabase.from("invitations").insert({ organisation_id: row.organisationId, email: row.email, role: row.role, job_title: row.jobTitle, invited_by: row.invitedBy, token_hash: row.tokenHash, expires_at: row.expiresAt }).select("id").single(); if (error) throw error; return data;
  }});
  redirect(`/app/settings?invite=${encodeURIComponent(result.token)}`);
}

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

export async function revokeInvitationAction(formData: FormData) {
  const { supabase, membership, organisation } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_members")) throw new Error("You are not allowed to manage invitations");
  const email = String(formData.get("email"));
  const { data: invitation, error: readError } = await supabase.from("invitations").select("role")
    .eq("organisation_id", organisation.id).eq("email", email).is("accepted_at", null).maybeSingle();
  if (readError || !invitation || !canInviteRole(membership.role, invitation.role as MembershipRole)) {
    throw new Error("You are not allowed to revoke that invitation");
  }
  const { error } = await supabase.from("invitations").delete()
    .eq("organisation_id", organisation.id).eq("email", email).is("accepted_at", null);
  if (error) throw new Error("Could not revoke the invitation");
  revalidatePath("/app/settings");
}

export async function acceptInvitationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect(`/sign-in?message=${encodeURIComponent("Sign in before accepting the invitation.")}`);
  const { error } = await supabase.rpc("accept_invitation", { raw_token: String(formData.get("token")) });
  if (error) redirect(`/app/invitations/accept?message=${encodeURIComponent("Invitation is invalid, expired, or belongs to another email address.")}`);
  redirect("/app");
}
