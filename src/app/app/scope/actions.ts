"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const scopeSchema = z.object({
  scopeStatement: z.string().trim().max(10_000), services: z.string().trim().max(10_000), locations: z.string().trim().max(10_000),
  informationTypes: z.string().trim().max(10_000), dependencies: z.string().trim().max(10_000), exclusions: z.string().trim().max(10_000),
});

export async function saveScopeProfileAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can update the organisation scope");
  await enforceRateLimit(`scope:${user.id}`, { limit: 20, windowMs: 60_000 });
  const parsed = scopeSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("organisation_scope_profiles").upsert({
    organisation_id: organisation.id, scope_statement: parsed.scopeStatement, services: parsed.services, locations: parsed.locations,
    information_types: parsed.informationTypes, dependencies: parsed.dependencies, exclusions: parsed.exclusions, updated_by: user.id,
  });
  if (error) throw new Error("Could not save organisation scope");
  revalidatePath("/app/scope"); revalidatePath("/app/audits");
}
