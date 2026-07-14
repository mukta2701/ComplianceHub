"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { crosswalkInputSchema } from "@/features/controls/application/crosswalk";
import { hasCapability } from "@/features/organisations/domain/access";

async function requireFrameworkManager() {
  const context = await requireAppContext();
  if (!hasCapability(context.membership.role, "manage_frameworks")) {
    throw new Error("Only workspace operators can manage framework mappings");
  }
  return context;
}

export async function addControlCrosswalkAction(formData: FormData) {
  const { supabase, user, organisation } = await requireFrameworkManager();
  await enforceRateLimit(`crosswalk:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = crosswalkInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("control_crosswalks").insert({
    organisation_id: organisation.id,
    control_id: parsed.controlId,
    framework: parsed.framework,
    external_ref: parsed.externalRef,
    note: parsed.note,
    created_by: user.id,
  });
  if (error) {
    // 23505 = the unique (organisation_id, control_id, framework, external_ref).
    if (error.code === "23505") throw new Error("That control is already mapped to this framework requirement.");
    throw new Error("Could not save the mapping");
  }
  revalidatePath("/app/frameworks");
}

export async function deleteControlCrosswalkAction(formData: FormData) {
  const { supabase, user, organisation } = await requireFrameworkManager();
  const id = z.uuid().parse(String(formData.get("id")));
  await enforceRateLimit(`crosswalk:${user.id}`, { limit: 30, windowMs: 60_000 });
  const { data, error } = await supabase.from("control_crosswalks")
    .delete()
    .eq("id", id)
    .eq("organisation_id", organisation.id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not remove the mapping");
  if (!data) throw new Error("Mapping was not found in this workspace");
  revalidatePath("/app/frameworks");
}
