"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assetInputSchema } from "@/features/assets/application/asset";

function toRow(parsed: ReturnType<typeof assetInputSchema.parse>, organisationId: string) {
  return {
    organisation_id: organisationId, reference: parsed.reference, description: parsed.description,
    owner_location: parsed.ownerLocation, owner_id: parsed.ownerId, classification: parsed.classification,
    value_criticality: parsed.valueCriticality, category_id: parsed.categoryId, security_controls: parsed.securityControls,
    lifespan: parsed.lifespan, last_updated: parsed.lastUpdated, remarks: parsed.remarks,
  };
}

export async function createAssetAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`asset:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = assetInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("assets").insert({ ...toRow(parsed, organisation.id), created_by: user.id });
  if (error) throw new Error("Could not save the asset");
  revalidatePath("/app/assets"); redirect("/app/assets");
}

export async function updateAssetAction(formData: FormData) {
  const { supabase, organisation } = await requireAppContext();
  const id = String(formData.get("id"));
  const parsed = assetInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("assets").update({ ...toRow(parsed, organisation.id), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the asset");
  revalidatePath(`/app/assets/${id}`); redirect(`/app/assets/${id}`);
}

export async function deleteAssetAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const { error } = await supabase.from("assets").delete().eq("id", String(formData.get("id"))); if (error) throw new Error("Could not delete the asset");
  revalidatePath("/app/assets"); redirect("/app/assets");
}

export async function linkAssetRiskAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const assetId = String(formData.get("assetId"));
  const { error } = await supabase.from("asset_risks").insert({ organisation_id: organisation.id, asset_id: assetId, risk_id: String(formData.get("riskId")), created_by: user.id });
  if (error) throw new Error("Could not link the risk");
  revalidatePath(`/app/assets/${assetId}`);
}

export async function unlinkAssetRiskAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const assetId = String(formData.get("assetId"));
  const { error } = await supabase.from("asset_risks").delete().eq("asset_id", assetId).eq("risk_id", String(formData.get("riskId"))); if (error) throw new Error("Could not unlink the risk");
  revalidatePath(`/app/assets/${assetId}`);
}
