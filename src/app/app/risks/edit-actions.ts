"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { riskInputSchema } from "@/features/risks/application/risk";
import { createRiskAction } from "../actions";

export type RiskFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined>; conflict?: boolean };

function riskValidationState(error: z.ZodError): RiskFormState {
  return { error: "Check the highlighted fields and try again.", fieldErrors: error.flatten().fieldErrors };
}

export async function updateRiskAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Only workspace operators can update risks");
  await enforceRateLimit(`risk:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = z.uuid().parse(formData.get("id"));
  const expectedUpdatedAt = z.iso.datetime({ offset: true }).parse(String(formData.get("expectedUpdatedAt")));
  const { data: current, error: currentError } = await supabase.from("risks").select("id,updated_at")
    .eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (currentError) throw new Error("Could not load the risk before saving");
  if (!current) throw new Error("Risk not found in the active workspace");
  if (current.updated_at !== expectedUpdatedAt) throw new Error("This risk changed or is no longer available. Reload it before saving again.");
  const parsed = riskInputSchema.omit({ sourceAssessmentSessionId: true, sourceSoaRegisterId: true }).parse({
    ...Object.fromEntries(formData), organisationId: organisation.id, ownerId: formData.get("ownerId") || null,
  });
  const { data: category, error: categoryError } = await supabase.from("risk_categories").select("id")
    .eq("id", parsed.categoryId).eq("organisation_id", organisation.id).maybeSingle();
  if (categoryError || !category) throw new Error("Risk category not found in the active workspace");
  if (parsed.ownerId) {
    const { data: owner, error: ownerError } = await supabase.from("memberships").select("user_id")
      .eq("organisation_id", organisation.id).eq("user_id", parsed.ownerId).maybeSingle();
    if (ownerError || !owner) throw new Error("Risk owner not found in the active workspace");
  }
  const { data: updated, error } = await supabase.from("risks").update({
    reference: parsed.reference, title: parsed.title, description: parsed.description,
    category_id: parsed.categoryId, owner_id: parsed.ownerId,
    likelihood: parsed.likelihood, impact: parsed.impact,
    residual_likelihood: parsed.residualLikelihood, residual_impact: parsed.residualImpact,
    treatment: parsed.treatment, treatment_plan: parsed.treatmentPlan,
    review_date: parsed.reviewDate || null, status: parsed.status, evidence: parsed.evidence,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("organisation_id", organisation.id).eq("updated_at", expectedUpdatedAt).select("id").maybeSingle();
  if (error) throw new Error("Could not update the risk");
  if (!updated) throw new Error("This risk changed or is no longer available. Reload it before saving again.");
  revalidatePath("/app/risks");
  revalidatePath(`/app/risks/${id}`);
  revalidatePath("/app");
  revalidatePath("/app/reports/readiness");
  redirect(`/app/risks/${id}`);
}

export async function createRiskFormAction(_previous: RiskFormState, formData: FormData): Promise<RiskFormState> {
  try {
    await createRiskAction(formData);
    return {};
  } catch (error) {
    if (error instanceof z.ZodError) return riskValidationState(error);
    if (error instanceof Error && error.message === "Could not save risk") return { error: "Could not save risk. Try again." };
    throw error;
  }
}

export async function updateRiskFormAction(_previous: RiskFormState, formData: FormData): Promise<RiskFormState> {
  try {
    await updateRiskAction(formData);
    return {};
  } catch (error) {
    if (error instanceof z.ZodError) return riskValidationState(error);
    if (error instanceof Error && error.message === "Could not update the risk") return { error: "Could not save risk. Try again." };
    if (error instanceof Error && error.message.startsWith("This risk changed or is no longer available")) return { error: error.message, conflict: true };
    throw error;
  }
}
