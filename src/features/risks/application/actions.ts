"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { one } from "@/lib/supabase/one";
import { nextRiskReference } from "@/features/risks/domain/risks";
import { riskInputSchema } from "@/features/risks/application/risk";

export async function createRiskAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role === "member") throw new Error("Only workspace operators can create risks");
  await enforceRateLimit(`risk:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = riskInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id, ownerId: formData.get("ownerId") || null });
  const { error } = await supabase.from("risks").insert({ organisation_id: organisation.id, reference: parsed.reference, title: parsed.title, description: parsed.description, category_id: parsed.categoryId, owner_id: parsed.ownerId || null, likelihood: parsed.likelihood, impact: parsed.impact, treatment: parsed.treatment, treatment_plan: parsed.treatmentPlan, residual_likelihood: parsed.residualLikelihood, residual_impact: parsed.residualImpact, review_date: parsed.reviewDate || null, status: parsed.status, evidence: parsed.evidence, source_assessment_session_id: parsed.sourceAssessmentSessionId || null, source_soa_register_id: parsed.sourceSoaRegisterId || null, created_by: user.id });
  if (error) throw new Error("Could not save risk");
  revalidatePath("/app/risks"); redirect("/app/risks");
}

export async function deleteRiskAction(formData: FormData) {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") throw new Error("Only workspace operators can delete risks");
  const { data, error } = await supabase.from("risks").delete().eq("id", String(formData.get("id"))).eq("organisation_id", organisation.id).select("id").maybeSingle();
  if (error || !data) throw new Error("Could not delete the risk");
  revalidatePath("/app/risks");
}

export async function updateRiskStatusAction(formData: FormData) {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") throw new Error("Only workspace operators can update risks");
  const status = String(formData.get("status")); if (!["open","treating","accepted","closed"].includes(status)) throw new Error("Invalid risk status");
  const { data, error } = await supabase.from("risks").update({ status, updated_at: new Date().toISOString() }).eq("id", String(formData.get("id"))).eq("organisation_id", organisation.id).select("id").maybeSingle();
  if (error || !data) throw new Error("Could not update risk");
  revalidatePath("/app/risks");
}

export async function acceptRiskSuggestionAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role === "member") throw new Error("Only workspace operators can accept risk suggestions");
  const questionId = z.uuid().parse(formData.get("questionId"));
  const sessionId = z.uuid().parse(formData.get("sessionId"));
  const { data: response, error: responseError } = await supabase.from("assessment_responses")
    .select("answer,updated_at,catalogue_questions!assessment_responses_question_id_fkey(code,prompt,remediation,weight)")
    .eq("organisation_id", organisation.id)
    .eq("session_id", sessionId)
    .eq("question_id", questionId)
    .in("answer", ["no", "partially"])
    .maybeSingle();
  if (responseError) throw new Error("Could not verify the assessment gap");
  const question = one(response?.catalogue_questions);
  if (!response || !question) throw new Error("This assessment gap is no longer available");

  const { data: existingReferences, error: referenceError } = await supabase.from("risks")
    .select("reference")
    .eq("organisation_id", organisation.id);
  if (referenceError) throw new Error("Could not prepare a risk reference");
  const reference = nextRiskReference((existingReferences ?? []).map((risk) => risk.reference));
  const rating = Math.max(1, Math.min(5, Math.round(Number(question.weight))));
  const { data: readinessCat, error: categoryError } = await supabase.from("risk_categories")
    .select("id").eq("name", "Readiness").eq("organisation_id", organisation.id).maybeSingle();
  if (categoryError) throw new Error("Could not load the readiness risk category");
  let categoryId = readinessCat?.id ?? null;
  if (!categoryId) {
    const { data: maxPos, error: positionError } = await supabase.from("risk_categories").select("position").eq("organisation_id", organisation.id).order("position", { ascending: false }).limit(1).maybeSingle();
    if (positionError) throw new Error("Could not prepare the readiness risk category");
    const { data: created, error: createCategoryError } = await supabase.from("risk_categories")
      .insert({ organisation_id: organisation.id, name: "Readiness", position: (maxPos?.position ?? -1) + 1 })
      .select("id").single();
    if (createCategoryError || !created) throw new Error("Could not create the readiness risk category");
    categoryId = created.id;
  }
  const sourceNote = `Assessment gap source: ${question.code}; question ${questionId}; answer ${response.answer}; observed response update ${response.updated_at}. Human review required.`;
  const { error } = await supabase.from("risks").insert({ organisation_id:organisation.id,reference,title:`Readiness gap: ${question.prompt}`,description:"This risk was accepted from an assessment gap and requires an owner review.",category_id:categoryId,likelihood:Math.min(5,rating+1),impact:rating,treatment:"mitigate",treatment_plan:question.remediation,residual_likelihood:rating,residual_impact:rating,status:"open",evidence:sourceNote,source_assessment_session_id:sessionId,created_by:user.id });
  if (error) throw new Error("Could not accept risk suggestion");
  revalidatePath("/app/risks");
}
