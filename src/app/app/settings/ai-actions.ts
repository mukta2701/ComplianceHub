"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";

export async function updateAiOptInAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can change AI settings");
  const { error } = await supabase.from("ai_workspace_settings").upsert({ organisation_id: organisation.id, enabled: formData.get("enabled") === "true", updated_by: user.id });
  if (error) throw new Error("Could not update AI settings");
  revalidatePath("/app/settings");
  revalidatePath("/app/assessment");
}
