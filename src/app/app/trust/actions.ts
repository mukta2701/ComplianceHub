"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { hasCapability } from "@/features/organisations/domain/access";

async function requireTrustCenterManager() {
  const context = await requireAppContext();
  if (!hasCapability(context.membership.role, "manage_trust_center")) {
    throw new Error("Only workspace operators can manage the Trust Center");
  }
  return context;
}

// Slug charset mirrors the DB check (^[a-z0-9-]+$). Headline is bounded to match
// the trust_center_settings.headline length check.
const saveSchema = z.object({
  enabled: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  slug: z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only"),
  showPolicyTitles: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  headline: z.string().trim().max(280).optional(),
});

export async function saveTrustCenterAction(formData: FormData) {
  const { supabase, user, organisation } = await requireTrustCenterManager();
  await enforceRateLimit(`trust-center:${user.id}`, { limit: 20, windowMs: 60_000 });
  const parsed = saveSchema.parse({
    enabled: formData.get("enabled"),
    slug: formData.get("slug"),
    showPolicyTitles: formData.get("showPolicyTitles"),
    headline: formData.get("headline") ?? undefined,
  });
  const { error } = await supabase.from("trust_center_settings").upsert({
    organisation_id: organisation.id,
    enabled: parsed.enabled,
    slug: parsed.slug,
    show_policy_titles: parsed.showPolicyTitles,
    headline: parsed.headline ? parsed.headline : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organisation_id" });
  if (error) {
    if (error.code === "23505") throw new Error("That web address is already taken. Please choose another slug.");
    throw new Error("Could not save the Trust Center settings");
  }
  revalidatePath("/app/trust");
}

export async function disableTrustCenterAction() {
  const { supabase, organisation } = await requireTrustCenterManager();
  const { error } = await supabase.from("trust_center_settings")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("organisation_id", organisation.id);
  if (error) throw new Error("Could not switch off the Trust Center");
  revalidatePath("/app/trust");
}
