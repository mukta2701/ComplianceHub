"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { kpiInputSchema, kpiMeasurementInputSchema } from "@/features/kpis/application/kpi";

function toRow(parsed: ReturnType<typeof kpiInputSchema.parse>, organisationId: string) {
  return {
    organisation_id: organisationId, control_function: parsed.controlFunction, indicator: parsed.indicator,
    measurement_type: parsed.measurementType, threshold: parsed.threshold, observations: parsed.observations,
    next_steps: parsed.nextSteps, responsible_id: parsed.responsibleId, last_reviewed: parsed.lastReviewed,
  };
}

export async function createKpiAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`kpi:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = kpiInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("kpis").insert({ ...toRow(parsed, organisation.id), created_by: user.id });
  if (error) throw new Error("Could not save the KPI");
  revalidatePath("/app/kpis");
}

export async function updateKpiAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`kpi:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const parsed = kpiInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("kpis").update({ ...toRow(parsed, organisation.id), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the KPI");
  revalidatePath("/app/kpis");
}

export async function recordKpiMeasurementAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`kpi:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = kpiMeasurementInputSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("kpi_measurements").insert({
    organisation_id: organisation.id, kpi_id: parsed.kpiId, value: parsed.value,
    measured_on: parsed.measuredOn, note: parsed.note, created_by: user.id,
  });
  if (error) throw new Error("Could not record the measurement");
  const { error: reviewError } = await supabase.from("kpis").update({ last_reviewed: parsed.measuredOn, updated_at: new Date().toISOString() }).eq("id", parsed.kpiId);
  if (reviewError) throw new Error("Could not update the KPI review date");
  revalidatePath("/app/kpis");
}

export async function raiseKpiTaskAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`kpi:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const indicator = String(formData.get("indicator"));
  const nextSteps = String(formData.get("nextSteps"));
  const ownerId = String(formData.get("ownerId") || "") || null;
  const { data: task, error } = await supabase.from("tasks").insert({
    organisation_id: organisation.id, title: `KPI follow-up: ${indicator}`.slice(0, 200),
    detail: nextSteps, owner_id: ownerId, source: "manual", created_by: user.id,
  }).select("id").single();
  if (error) throw new Error("Could not raise the task");
  const { error: linkError } = await supabase.from("kpis").update({ task_id: task.id }).eq("id", id); if (linkError) throw new Error("Raised the task but could not link it to the KPI");
  revalidatePath("/app/kpis"); revalidatePath("/app/tasks");
}
