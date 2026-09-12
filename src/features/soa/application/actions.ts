"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { soaItemReviewSchema } from "@/features/soa/application/review";
import { collectSoaFinalisationBlockers, countSoaFinalisationBlockers, loadSoaFinalisationPreflight, SOA_CATALOGUE_SIZE } from "@/features/soa/application/finalisation";

export async function createAssessmentAction() {
  const { supabase, user, organisation } = await requireAppContext();
  const { data: catalogue } = await supabase.from("catalogue_versions").select("id").not("published_at", "is", null).order("published_at", { ascending: false }).limit(1).single();
  if (!catalogue) redirect("/app/assessment?message=No%20published%20catalogue%20is%20available.");
  const { data, error } = await supabase.from("assessment_sessions").insert({ organisation_id: organisation.id, catalogue_version_id: catalogue.id, title: `Readiness assessment ${new Date().toLocaleDateString("en-GB")}`, created_by: user.id }).select("id").single();
  if (error) redirect("/app/assessment?message=Could%20not%20create%20the%20assessment.");
  redirect(`/app/assessment/${data.id}`);
}

export async function createSoaAction(formData: FormData) {
  const { supabase, organisation } = await requireAppContext();
  const assessmentId = z.uuid().parse(formData.get("assessmentId"));
  const { data: assessment, error: assessmentError } = await supabase
    .from("assessment_sessions")
    .select("id")
    .eq("id", assessmentId)
    .eq("organisation_id", organisation.id)
    .maybeSingle();
  if (assessmentError || !assessment) throw new Error("Assessment not found in the active workspace");
  const { data: registerId, error } = await supabase.rpc("create_or_reuse_soa_review", {
    target_assessment_session_id: assessmentId,
  });
  if (error || !registerId) throw new Error("Could not start control review");
  revalidatePath("/app/assessment");
  revalidatePath("/app/soa");
  redirect(`/app/soa/${registerId}`);
}

export async function createSoaSuccessorAction(formData: FormData) {
  const { supabase, organisation } = await requireAppContext();
  const sourceRegisterId = z.uuid().parse(formData.get("registerId"));
  const { data: source, error: sourceError } = await supabase
    .from("soa_registers")
    .select("id")
    .eq("id", sourceRegisterId)
    .eq("organisation_id", organisation.id)
    .maybeSingle();
  if (sourceError || !source) throw new Error("Finalised statement not found in the active workspace");
  const { data: registerId, error } = await supabase.rpc("create_or_reuse_soa_successor", {
    source_register_id: sourceRegisterId,
  });
  if (error || !registerId) throw new Error("Could not create next control review version");
  revalidatePath("/app/assessment");
  revalidatePath("/app/soa");
  redirect(`/app/soa/${registerId}`);
}

export type SaveSoaDecisionResult =
  | { status: "saved"; revision: number }
  | { status: "stale" | "missing" | "forbidden"; message: string };

const staleSoaDecisionResult = (): SaveSoaDecisionResult => ({
  status: "stale",
  message: "This control changed after you opened it. Refresh and reconcile your draft before saving again.",
});
const missingSoaDecisionResult = (): SaveSoaDecisionResult => ({
  status: "missing",
  message: "This control is no longer available. Refresh the review before saving again.",
});
const forbiddenSoaDecisionResult = (invalid = false): SaveSoaDecisionResult => ({
  status: "forbidden",
  message: invalid
    ? "This decision is no longer valid. Refresh and check the control owner before saving again."
    : "You cannot update this control review. Refresh to check your current access and review state.",
});

function mapSoaDecisionError(error: unknown): SaveSoaDecisionResult {
  if (!error || typeof error !== "object") return forbiddenSoaDecisionResult();
  const record = error as { code?: unknown; message?: unknown; details?: unknown };
  if (record.code === "PT409" && record.message === "control_decision_stale" && record.details === "revision_mismatch") return staleSoaDecisionResult();
  if (record.code === "P0002" && record.message === "control_decision_missing" && record.details === "item_unavailable") return missingSoaDecisionResult();
  if (record.code === "22023" && record.message === "control_decision_invalid") return forbiddenSoaDecisionResult(true);
  return forbiddenSoaDecisionResult();
}

export async function reviewSoaItemAction(formData: FormData): Promise<SaveSoaDecisionResult> {
  const { supabase, organisation } = await requireAppContext();
  const parsedReview = soaItemReviewSchema.safeParse({ itemId: formData.get("itemId"), status: formData.get("status"), applicable: formData.get("applicable") === "true", justification: formData.get("justification"), evidence: formData.get("evidence") });
  const parsedRegisterId = z.uuid().safeParse(formData.get("registerId"));
  const parsedRevision = z.coerce.number().int().nonnegative().safe().safeParse(formData.get("expectedRevision"));
  const rawOwnerId = formData.get("ownerId");
  const parsedOwnerId = rawOwnerId ? z.uuid().safeParse(String(rawOwnerId)) : { success: true as const, data: null };
  if (!parsedReview.success || !parsedRegisterId.success || !parsedRevision.success || !parsedOwnerId.success) return forbiddenSoaDecisionResult(true);
  const parsed = parsedReview.data;
  const { data: activeRegister, error: registerError } = await supabase
    .from("soa_registers")
    .select("id")
    .eq("id", parsedRegisterId.data)
    .eq("organisation_id", organisation.id)
    .maybeSingle();
  if (registerError || !activeRegister) return forbiddenSoaDecisionResult();
  const { data, error } = await supabase.rpc("update_soa_decisions_guarded", {
    target_register_id: parsedRegisterId.data,
    changes: [{
      itemId: parsed.itemId,
      expectedRevision: parsedRevision.data,
      applicable: parsed.applicable,
      status: parsed.status,
      justification: parsed.justification,
      evidence: parsed.evidence,
      ownerId: parsedOwnerId.data,
    }],
  });
  if (error) return mapSoaDecisionError(error);
  const result = Array.isArray(data) ? data[0] : null;
  if (!result || result.item_id !== parsed.itemId || !Number.isSafeInteger(Number(result.decision_revision))) return missingSoaDecisionResult();
  revalidatePath("/app/soa");
  return { status: "saved", revision: Number(result.decision_revision) };
}

export async function finaliseSoaAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role === "member") throw new Error("Only workspace Owners and Admins can finalise a Statement of Applicability");
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

  const preflight = await loadSoaFinalisationPreflight(supabase, organisation.id, register.id);

  const blockers = collectSoaFinalisationBlockers(preflight.items, preflight.liveEvidence, preflight.expiredEvidence);
  if (countSoaFinalisationBlockers(blockers) > 0) {
    const details = [
      blockers.incompleteCatalogue ? `the complete ${SOA_CATALOGUE_SIZE}-control catalogue is required` : null,
      blockers.expiredEvidence.length ? `${blockers.expiredEvidence.length} with expired evidence` : null,
      blockers.pending.length ? `${blockers.pending.length} pending` : null,
      blockers.missingRationale.length ? `${blockers.missingRationale.length} missing rationale` : null,
      blockers.unassigned.length ? `${blockers.unassigned.length} unassigned` : null,
      blockers.missingEvidence.length ? `${blockers.missingEvidence.length} missing live evidence` : null,
    ].filter(Boolean).join(", ");
    throw new Error(`SoA cannot be finalised: ${details}`);
  }

  const { data, error } = await supabase.rpc("finalise_soa", { target_register_id: register.id });
  if (error) throw new Error("Could not finalise the SoA");
  redirect(`/app/soa?finalised=${data}`);
}
