"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { crosswalkInputSchema } from "@/features/controls/application/crosswalk";

export async function addControlCrosswalkAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
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
  const { supabase, user } = await requireAppContext();
  await enforceRateLimit(`crosswalk:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const { error } = await supabase.from("control_crosswalks").delete().eq("id", id);
  if (error) throw new Error("Could not remove the mapping");
  revalidatePath("/app/frameworks");
}
