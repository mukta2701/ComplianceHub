"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { encryptSecret } from "@/lib/security/secrets";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildMonitorDependencies } from "@/features/monitoring/application/monitor-deps";
import { runMonitoring } from "@/features/monitoring/application/monitor-run";

const sourceSchema = z.object({
  owner: z.string().trim().min(1, "GitHub owner is required").max(120),
  repo: z.string().trim().min(1, "Repository is required").max(120),
  label: z.string().trim().max(160).optional(),
  accessToken: z.string().trim().max(400).optional(),
});

// The webhook is treated like a credential (stored in config, never read back to
// the client). Restrict the host to Slack's incoming-webhook endpoint so a
// compromised form can't turn the hourly cron into an open POST relay (SSRF).
const channelSchema = z.object({
  webhookUrl: z.string().trim().url().refine((u) => u.startsWith("https://hooks.slack.com/"), "Must be a Slack incoming-webhook URL (https://hooks.slack.com/…)"),
  minSeverity: z.enum(["low", "medium", "high", "critical"]),
  label: z.string().trim().max(160).optional(),
});

async function requireOwner() {
  const ctx = await requireAppContext();
  if (ctx.membership.role !== "owner") throw new Error("Only workspace owners can manage monitoring");
  return ctx;
}

export async function addMonitorSourceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireOwner();
  await enforceRateLimit(`monitor-source:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = sourceSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("monitor_sources").insert({
    organisation_id: organisation.id, provider: "github",
    label: parsed.label || `${parsed.owner}/${parsed.repo}`,
    config: { owner: parsed.owner, repo: parsed.repo },
    access_token: encryptSecret(parsed.accessToken || null), connected_by: user.id,
  });
  if (error) throw new Error("Could not add the monitoring source");
  revalidatePath("/app/monitoring");
}

export async function revokeMonitorSourceAction(formData: FormData) {
  const { supabase } = await requireOwner();
  const { error } = await supabase.from("monitor_sources")
    .update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not disconnect the monitoring source");
  revalidatePath("/app/monitoring");
}

export async function addAlertChannelAction(formData: FormData) {
  const { supabase, user, organisation } = await requireOwner();
  await enforceRateLimit(`alert-channel:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = channelSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("alert_channels").insert({
    organisation_id: organisation.id, type: "slack", label: parsed.label || "Slack",
    config: { webhookUrl: encryptSecret(parsed.webhookUrl) }, min_severity: parsed.minSeverity, connected_by: user.id,
  });
  if (error) throw new Error("Could not add the alert channel");
  revalidatePath("/app/monitoring");
}

export async function revokeAlertChannelAction(formData: FormData) {
  const { supabase } = await requireOwner();
  const { error } = await supabase.from("alert_channels")
    .update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not remove the alert channel");
  revalidatePath("/app/monitoring");
}

export async function acknowledgeFindingAction(formData: FormData) {
  const { supabase } = await requireOwner();
  const { error } = await supabase.from("monitoring_findings")
    .update({ status: "acknowledged" }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not acknowledge the finding");
  revalidatePath("/app/monitoring");
}

export async function resolveFindingAction(formData: FormData) {
  const { supabase } = await requireOwner();
  const { error } = await supabase.from("monitoring_findings")
    .update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not resolve the finding");
  revalidatePath("/app/monitoring");
}

export async function raiseTaskFromFindingAction(formData: FormData) {
  const { supabase, user, organisation } = await requireOwner();
  const id = String(formData.get("id"));
  const { data: finding, error: readError } = await supabase.from("monitoring_findings")
    .select("id,title,detail,control_ref,subject_id,task_id").eq("id", id).maybeSingle();
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
    .update({ task_id: task.id, status: "acknowledged" }).eq("id", id);
  if (linkError) throw new Error("Raised the task but could not link it to the finding");
  revalidatePath("/app/monitoring");
}

// One-click "Run checks now" — the demo/manual equivalent of the hourly cron,
// scoped to just this org. Uses the service client (findings + notifications are
// service-role-insert only) but restricts every query to the caller's org.
export async function runMonitoringNowAction() {
  const { organisation } = await requireOwner();
  const service = createSupabaseServiceClient();
  await runMonitoring(buildMonitorDependencies(service, { organisationId: organisation.id }));
  revalidatePath("/app/monitoring");
  revalidatePath("/app/notifications");
}

// Polled by the in-app <AlertToaster/> to pop a toast when monitoring raises a
// new alert while you're in the app. RLS scopes notifications to the caller.
export async function fetchRecentAlertsAction(): Promise<Array<{ id: number; message: string; kind: string; createdAt: string }>> {
  const { supabase } = await requireAppContext();
  const { data } = await supabase.from("notifications")
    .select("id,kind,message,created_at").is("read_at", null)
    .in("kind", ["policy_violation", "control_drift"]).order("created_at", { ascending: false }).limit(5);
  return (data ?? []).map((n) => ({ id: n.id as number, message: n.message as string, kind: n.kind as string, createdAt: n.created_at as string }));
}
