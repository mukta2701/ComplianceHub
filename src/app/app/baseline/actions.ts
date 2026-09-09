"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { baselineInputSchema, type BaselineState } from "@/features/baselines/domain/summary";

export async function saveBaselineAction(_state: BaselineState, form: FormData): Promise<BaselineState> {
  const { supabase, organisation, membership, user } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") return { error: "Only a workspace coordinator can save a baseline." };
  const parsed = baselineInputSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the baseline details." };
  await enforceRateLimit(`baseline-save:${user.id}`, { limit: 20, windowMs: 60_000 });
  const input = parsed.data;
  const { data, error } = await supabase.rpc("save_baseline_progress", {
    target_organisation_id: organisation.id, expected_revision: input.revision,
    baseline_objective: input.objective, selected_assessment_id: input.assessmentId || null,
    save_request_id: input.requestId, create_snapshot: input.intent === "snapshot",
  });
  if (error || !data) {
    if (error?.code === "PT409") return { error: "Reload before saving. Another coordinator changed this baseline; your entered objective is still shown below." };
    if (error?.code === "42501") return { error: "Your workspace access or assessment selection has changed. Reload before saving." };
    if (error?.code === "22023") return { error: "This save request no longer matches the saved input. Reload before starting a new save." };
    return { error: "Could not save the baseline. Please try again." };
  }
  revalidatePath("/app/baseline"); revalidatePath("/app");
  return { success: input.intent === "snapshot" ? "Dated baseline saved. Earlier baselines remain unchanged." : "Progress saved. You can return to this baseline later.", revision: data.revision, snapshotId: data.snapshot_id, requestId: randomUUID() };
}
