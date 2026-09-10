"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assetInputSchema } from "@/features/assets/application/asset";
import { z } from "zod";

function requireAssetManager(role: "owner" | "admin" | "member") {
  if (role === "member") throw new Error("Only workspace operators can manage assets");
}

function toRow(parsed: ReturnType<typeof assetInputSchema.parse>, organisationId: string) {
  return {
    organisation_id: organisationId, reference: parsed.reference, description: parsed.description,
    owner_location: parsed.ownerLocation, owner_id: parsed.ownerId, classification: parsed.classification,
    value_criticality: parsed.valueCriticality, category_id: parsed.categoryId, security_controls: parsed.securityControls,
    lifespan: parsed.lifespan, last_updated: parsed.lastUpdated, remarks: parsed.remarks,
  };
}

export async function createAssetAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireAssetManager(membership.role);
  await enforceRateLimit(`asset:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = assetInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("assets").insert({ ...toRow(parsed, organisation.id), created_by: user.id });
  if (error) throw new Error("Could not save the asset");
  revalidatePath("/app/assets"); redirect("/app/assets");
}

export async function updateAssetAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireAssetManager(membership.role);
  await enforceRateLimit(`asset:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = z.uuid().parse(formData.get("id"));
  const expectedUpdatedAt = z.iso.datetime({ offset: true }).parse(String(formData.get("expectedUpdatedAt")));
  const { data: current, error: currentError } = await supabase.from("assets").select("id,updated_at").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (currentError) throw new Error("Could not load the asset before saving");
  if (!current) throw new Error("Asset not found in the active workspace");
  if (current.updated_at !== expectedUpdatedAt) throw new Error("This asset changed or is no longer available. Reload it before saving again.");
  const parsed = assetInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  if (parsed.categoryId) {
    const { data: category, error } = await supabase.from("asset_categories").select("id").eq("id", parsed.categoryId).eq("organisation_id", organisation.id).maybeSingle();
    if (error || !category) throw new Error("Asset category not found in the active workspace");
  }
  if (parsed.ownerId) {
    const { data: owner, error } = await supabase.from("memberships").select("user_id").eq("organisation_id", organisation.id).eq("user_id", parsed.ownerId).maybeSingle();
    if (error || !owner) throw new Error("Asset owner not found in the active workspace");
  }
  const { data, error } = await supabase.from("assets").update({ ...toRow(parsed, organisation.id), updated_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", organisation.id).eq("updated_at", expectedUpdatedAt).select("id").maybeSingle();
  if (error) throw new Error("Could not update the asset");
  if (!data) throw new Error("This asset changed or is no longer available. Reload it before saving again.");
  revalidatePath("/app/assets"); revalidatePath(`/app/assets/${id}`); redirect(`/app/assets/${id}`);
}

export async function deleteAssetAction(formData: FormData) {
  const { supabase, organisation, membership } = await requireAppContext();
  requireAssetManager(membership.role);
  const { data, error } = await supabase.from("assets").delete().eq("id", String(formData.get("id"))).eq("organisation_id", organisation.id).select("id").maybeSingle(); if (error) throw new Error("Could not delete the asset");
  if (!data) throw new Error("Asset not found");
  revalidatePath("/app/assets"); redirect("/app/assets");
}

export async function linkAssetRiskAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireAssetManager(membership.role);
  const assetId = String(formData.get("assetId"));
  const riskId = String(formData.get("riskId"));
  if (!assetId || !riskId) throw new Error("Asset and risk IDs are required");
  const { error } = await supabase.from("asset_risks").insert({ organisation_id: organisation.id, asset_id: assetId, risk_id: riskId, created_by: user.id });
  if (error) throw new Error("Could not link the risk");
  revalidatePath(`/app/assets/${assetId}`);
  revalidatePath(`/app/risks/${riskId}`);
  revalidatePath("/app/assets");
}

export async function unlinkAssetRiskAction(formData: FormData) {
  const { supabase, organisation, membership } = await requireAppContext();
  requireAssetManager(membership.role);
  const assetId = String(formData.get("assetId"));
  const riskId = String(formData.get("riskId"));
  if (!assetId || !riskId) throw new Error("Asset and risk IDs are required");
  const { data, error } = await supabase.from("asset_risks").delete().eq("asset_id", assetId).eq("risk_id", riskId).eq("organisation_id", organisation.id).select("asset_id").maybeSingle(); if (error) throw new Error("Could not unlink the risk");
  if (!data) throw new Error("Asset risk link not found");
  revalidatePath(`/app/assets/${assetId}`);
  revalidatePath(`/app/risks/${riskId}`);
  revalidatePath("/app/assets");
}
