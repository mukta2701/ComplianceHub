"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";

const configSchema = z.object({
  lowMax: z.coerce.number().int().min(1).max(23),
  moderateMax: z.coerce.number().int().min(2).max(24),
  highMax: z.coerce.number().int().min(3).max(24),
  appetite: z.union([z.coerce.number().int().min(1).max(25), z.literal("")]).transform((v) => (v === "" ? null : v)),
}).refine((v) => v.lowMax < v.moderateMax && v.moderateMax < v.highMax, { message: "Thresholds must increase" });

export async function updateRiskMatrixConfigAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const parsed = configSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("risk_matrix_config").upsert({
    organisation_id: organisation.id, low_max: parsed.lowMax, moderate_max: parsed.moderateMax,
    high_max: parsed.highMax, appetite_threshold: parsed.appetite, updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organisation_id" });
  if (error) throw new Error("Could not update the risk matrix configuration");
  revalidatePath("/app/risks");
}
