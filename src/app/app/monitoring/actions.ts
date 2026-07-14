"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildMonitorDependencies } from "@/features/monitoring/application/monitor-deps";
import { runMonitoring } from "@/features/monitoring/application/monitor-run";
import { hasCapability } from "@/features/organisations/domain/access";

async function requireOperator() {
  const ctx = await requireAppContext();
  if (!hasCapability(ctx.membership.role, "run_monitoring")) throw new Error("Only workspace operators can run monitoring");
  return ctx;
}

async function requireMonitoringManager() {
  const ctx = await requireAppContext();
  if (!hasCapability(ctx.membership.role, "manage_monitoring")) throw new Error("Only workspace operators can manage monitoring configuration");
  return ctx;
}

export async function acknowledgeFindingAction(formData: FormData) {
  const { supabase, organisation } = await requireMonitoringManager();
  const id = z.uuid().parse(String(formData.get("id")));
  const { data, error } = await supabase.from("monitoring_findings")
    .update({ status: "acknowledged" }).eq("id", id).eq("organisation_id", organisation.id)
    .eq("status", "open").select("id").maybeSingle();
  if (error || !data) throw new Error("Finding was not found in this workspace");
  revalidatePath("/app/monitoring");
}

export async function resolveFindingAction(formData: FormData) {
  const { supabase, organisation } = await requireMonitoringManager();
  const id = z.uuid().parse(String(formData.get("id")));
  const { data, error } = await supabase.from("monitoring_findings")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id).eq("organisation_id", organisation.id)
    .in("status", ["open", "acknowledged"]).select("id").maybeSingle();
  if (error || !data) throw new Error("Finding was not found in this workspace");
  revalidatePath("/app/monitoring");
}

export async function raiseTaskFromFindingAction(formData: FormData) {
  const { supabase, user, organisation } = await requireMonitoringManager();
  const id = z.uuid().parse(String(formData.get("id")));
  const { data: finding, error: readError } = await supabase.from("monitoring_findings")
    .select("id,title,detail,control_ref,subject_id,task_id").eq("id", id)
    .eq("organisation_id", organisation.id).in("status", ["open", "acknowledged"]).maybeSingle();
  if (readError || !finding) throw new Error("Could not find the finding");
  if (finding.task_id) { revalidatePath("/app/monitoring"); return; } // already has a task
  const { data: task, error: taskError } = await supabase.from("tasks").insert({
    organisation_id: organisation.id,
    title: `Remediate: ${finding.title}`.slice(0, 200),
    detail: `${finding.detail}\n\nControl ${finding.control_ref} · ${finding.subject_id}. Raised from continuous monitoring.`,
    source: "monitoring", owner_id: user.id, created_by: user.id,
  }).select("id").single();
  if (taskError || !task) throw new Error("Could not raise the remediation task");
  const { error: linkError } = await supabase.from("monitoring_findings")
    .update({ task_id: task.id, status: "acknowledged" }).eq("id", id).eq("organisation_id", organisation.id);
  if (linkError) throw new Error("Raised the task but could not link it to the finding");
  revalidatePath("/app/monitoring");
}

// One-click "Run checks now" — the demo/manual equivalent of the hourly cron,
// scoped to just this org. Uses the service client (findings + notifications are
// service-role-insert only) but restricts every query to the caller's org.
export async function runMonitoringNowAction() {
  const { organisation } = await requireOperator();
  const service = createSupabaseServiceClient();
  await runMonitoring(buildMonitorDependencies(service, { organisationId: organisation.id }));
  revalidatePath("/app/monitoring");
  revalidatePath("/app/notifications");
}

// Polled by the in-app <AlertToaster/> to pop a toast when monitoring raises a
// new alert while you're in the app. RLS scopes notifications to the caller;
// the explicit organisation filter keeps multi-workspace users in the active one.
export async function fetchRecentAlertsAction(): Promise<Array<{ id: number; message: string; kind: string; createdAt: string }>> {
  const { supabase, organisation } = await requireAppContext();
  const { data } = await supabase.from("notifications")
    .select("id,kind,message,created_at").eq("organisation_id", organisation.id).is("read_at", null)
    .in("kind", ["policy_violation", "control_drift"]).order("created_at", { ascending: false }).limit(5);
  return (data ?? []).map((n) => ({ id: n.id as number, message: n.message as string, kind: n.kind as string, createdAt: n.created_at as string }));
}
