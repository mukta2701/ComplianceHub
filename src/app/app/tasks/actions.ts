"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { gapTaskInputSchema, taskInputSchema } from "@/features/tasks/application/task";
import { nextDueDate, type TaskRecurrence } from "@/features/tasks/domain/tasks";
import { z } from "zod";

const today = () => new Date().toISOString().slice(0, 10);

export async function createTaskAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Only workspace operators can create tasks");
  await enforceRateLimit(`task:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = taskInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("tasks").insert({
    organisation_id: organisation.id, title: parsed.title, detail: parsed.detail, status: parsed.status,
    owner_id: parsed.ownerId, due_on: parsed.dueOn, recurrence: parsed.recurrence, source: "manual",
    control_id: parsed.controlId, risk_id: parsed.riskId, created_by: user.id,
  });
  if (error) throw new Error("Could not save task");
  revalidatePath("/app/tasks"); redirect("/app/tasks");
}

export async function updateTaskStatusAction(formData: FormData) {
  const { supabase, organisation, membership, user } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Only workspace operators can update task status");
  await enforceRateLimit(`task-status:${user.id}`, { limit: 30, windowMs: 60_000 });
  const status = String(formData.get("status"));
  if (!["open", "in_progress", "done", "cancelled"].includes(status)) throw new Error("Invalid task status");
  const id = String(formData.get("id"));
  const { data: task, error: readError } = await supabase.from("tasks")
    .select("id,organisation_id,title,detail,owner_id,due_on,recurrence,source,control_id,risk_id,status").eq("id", id).eq("organisation_id", organisation.id).single();
  if (readError || !task) throw new Error("Task not found");
  if (status === "done" && task.status !== "done" && task.recurrence && task.due_on) {
    const { error } = await supabase.rpc("complete_recurring_task", {
      target_task_id: task.id,
    });
    if (error) throw new Error("Could not complete recurring task");
  } else {
    const { data, error } = await supabase.from("tasks").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", organisation.id).select("id").maybeSingle();
    if (error || !data) throw new Error("Could not update task");
  }
  revalidatePath("/app/tasks"); revalidatePath("/app");
}

export async function updateTaskAction(formData: FormData) {
  const { supabase, organisation, membership, user } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Only workspace operators can edit tasks");
  await enforceRateLimit(`task-edit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = z.uuid().parse(String(formData.get("id")));
  const expectedUpdatedAt = z.iso.datetime({ offset: true }).parse(String(formData.get("expectedUpdatedAt")));
  const parsed = taskInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data, error } = await supabase.from("tasks").update({
    title: parsed.title, detail: parsed.detail, owner_id: parsed.ownerId, due_on: parsed.dueOn,
    recurrence: parsed.recurrence, control_id: parsed.controlId, risk_id: parsed.riskId,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("organisation_id", organisation.id).eq("updated_at", expectedUpdatedAt).select("id").maybeSingle();
  if (error) throw new Error("Could not update task");
  if (!data) throw new Error("This task changed or is no longer available. Reload it before saving again.");
  revalidatePath("/app/tasks"); revalidatePath(`/app/tasks/${id}`); redirect(`/app/tasks/${id}`);
}

export type TaskFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined>; conflict?: boolean };

function taskValidationState(error: z.ZodError): TaskFormState {
  return { error: "Check the highlighted fields and try again.", fieldErrors: error.flatten().fieldErrors };
}

export async function createTaskFormAction(_previous: TaskFormState, formData: FormData): Promise<TaskFormState> {
  try {
    await createTaskAction(formData);
    return {};
  } catch (error) {
    if (error instanceof z.ZodError) return taskValidationState(error);
    if (error instanceof Error && error.message === "Could not save task") return { error: "Could not save task. Try again." };
    throw error;
  }
}

export async function updateTaskFormAction(_previous: TaskFormState, formData: FormData): Promise<TaskFormState> {
  try {
    await updateTaskAction(formData);
    return {};
  } catch (error) {
    if (error instanceof z.ZodError) return taskValidationState(error);
    if (error instanceof Error && error.message === "Could not update task") return { error: "Could not save task. Try again." };
    if (error instanceof Error && error.message.startsWith("This task changed or is no longer available")) return { error: error.message, conflict: true };
    throw error;
  }
}

export async function createGapTaskAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`task:${user.id}`, { limit: 30, windowMs: 60_000 });
  const questionId = String(formData.get("questionId"));
  const parsed = gapTaskInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data: question } = await supabase.from("catalogue_questions").select("prompt,remediation").eq("id", questionId).single();
  if (!question) throw new Error("Suggestion not found");
  const { data: acm } = await supabase.from("assessment_control_mappings").select("control_id").eq("catalogue_question_id", questionId).limit(1).maybeSingle();
  let controlId: string | null = null;
  if (acm) {
    const { data: rcm } = await supabase.from("requirement_control_mappings").select("control_id").eq("requirement_id", acm.control_id).limit(1).maybeSingle();
    controlId = rcm?.control_id ?? null;
  }
  const { error } = await supabase.from("tasks").insert({
    organisation_id: organisation.id, title: parsed.title, detail: parsed.detail,
    owner_id: parsed.ownerId, due_on: parsed.dueOn, source: "gap", control_id: controlId, created_by: user.id,
  });
  if (error) throw new Error("Could not accept task suggestion");
  revalidatePath("/app/tasks"); revalidatePath("/app/risks"); redirect("/app/tasks");
}

export async function acceptCalendarSeedAction() {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`task-seed:${user.id}`, { limit: 3, windowMs: 60_000 });
  const { data: items } = await supabase.from("task_catalogue_items").select("title,detail,recurrence").order("position");
  if (!items?.length) throw new Error("No starter calendar is available");
  const { error } = await supabase.from("tasks").insert(items.map((item) => ({
    organisation_id: organisation.id, title: item.title, detail: item.detail, source: "system" as const,
    recurrence: item.recurrence, due_on: nextDueDate(today(), item.recurrence as TaskRecurrence), created_by: user.id,
  })));
  if (error) throw new Error("Could not add the starter calendar");
  revalidatePath("/app/tasks"); redirect("/app/tasks");
}
