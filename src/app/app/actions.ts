"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOrganisation } from "@/features/organisations/application/organisation";
import { inviteMember } from "@/features/organisations/application/organisation";
import { riskInputSchema } from "@/features/risks/application/risk";
import { soaItemReviewSchema } from "@/features/soa/application/review";
import { requireAppContext } from "@/lib/app-context";
import { revalidatePath } from "next/cache";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function createOrganisationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  try {
    const organisation = await createOrganisation({ name: formData.get("name") }, {
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
    redirect(`/app?organisation=${organisation.id}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/app/onboarding?message=${encodeURIComponent("Could not create the organisation. Check the name and try again.")}`);
  }
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
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
  await supabase.from("risks").delete().eq("id", String(formData.get("id")));
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
  const { supabase } = await requireAppContext();
  const parsed = soaItemReviewSchema.parse({ itemId: formData.get("itemId"), status: formData.get("status"), applicable: formData.get("applicable") === "true", justification: formData.get("justification"), evidence: formData.get("evidence") });
  const ownerId = String(formData.get("ownerId")) || null;
  const { error } = await supabase.from("soa_items").update({ status: parsed.status, applicable: parsed.applicable, justification: parsed.justification, evidence: parsed.evidence, owner_id: ownerId }).eq("id", parsed.itemId);
  if (error) throw new Error("Could not update SoA item");
  revalidatePath("/app/soa");
}

export async function finaliseSoaAction(formData: FormData) {
  const { supabase, user } = await requireAppContext();
  await enforceRateLimit(`soa-finalise:${user.id}`, { limit: 5, windowMs: 60_000 });
  const registerId = String(formData.get("registerId"));
  const { data, error } = await supabase.rpc("finalise_soa", { target_register_id: registerId });
  if (error) throw new Error(error.message);
  redirect(`/app/soa?finalised=${data}`);
}

export async function inviteMemberAction(formData: FormData) {
  const { supabase, user, membership, organisation } = await requireAppContext();
  await enforceRateLimit(`invite:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  const result = await inviteMember({ organisationId: organisation.id, email: formData.get("email"), role: formData.get("role") }, { actorId: user.id, actorRole: membership.role, insertInvitation: async (row) => {
    const { data, error } = await supabase.from("invitations").insert({ organisation_id: row.organisationId, email: row.email, role: row.role, invited_by: row.invitedBy, token_hash: row.tokenHash, expires_at: row.expiresAt }).select("id").single(); if (error) throw error; return data;
  }});
  redirect(`/app/settings?invite=${encodeURIComponent(result.token)}`);
}

export async function acceptInvitationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect(`/sign-in?message=${encodeURIComponent("Sign in before accepting the invitation.")}`);
  const { error } = await supabase.rpc("accept_invitation", { raw_token: String(formData.get("token")) });
  if (error) redirect(`/app/invitations/accept?message=${encodeURIComponent("Invitation is invalid, expired, or belongs to another email address.")}`);
  redirect("/app");
}
