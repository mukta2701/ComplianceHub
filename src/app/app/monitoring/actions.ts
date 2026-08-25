"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildMonitorDependencies } from "@/features/monitoring/application/monitor-deps";
import { runMonitoring } from "@/features/monitoring/application/monitor-run";
import { hasCapability } from "@/features/organisations/domain/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const githubFindingTransitionSchema = z.object({
  id: z.uuid(),
  status: z.enum(["open", "acknowledged", "in_progress", "exception_requested", "risk_accepted"]),
}).strict();

const GITHUB_FINDING_TRANSITION_REASON = {
  open: "returned_to_open",
  acknowledged: "owner_reviewed",
  in_progress: "remediation_started",
  exception_requested: "exception_review_requested",
  risk_accepted: "risk_acceptance_recorded",
} as const;

const GITHUB_FINDING_TRANSITION_LABEL = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  exception_requested: "Exception requested",
  risk_accepted: "Risk accepted",
} as const;

async function requireOperator() {
  const ctx = await requireAppContext();
  if (!hasCapability(ctx.membership.role, "run_monitoring")) throw new Error("Only workspace operators can run monitoring");
  return ctx;
}

async function requireMonitoringFindingManager() {
  const ctx = await requireAppContext();
  if (!hasCapability(ctx.membership.role, "manage_monitoring_findings")) throw new Error("Only workspace owners can manage monitoring findings");
  return ctx;
}

export async function acknowledgeFindingAction(formData: FormData) {
  const { supabase, user, organisation } = await requireMonitoringFindingManager();
  await enforceRateLimit(`monitoring-finding:${organisation.id}:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = z.uuid().parse(String(formData.get("id")));
  const { data, error } = await supabase.from("monitoring_findings")
    .update({ status: "acknowledged" }).eq("id", id).eq("organisation_id", organisation.id)
    .eq("status", "open").select("id").maybeSingle();
  if (error || !data) throw new Error("Finding was not found in this workspace");
  revalidatePath("/app/monitoring");
}

export async function resolveFindingAction(formData: FormData) {
  const { supabase, user, organisation } = await requireMonitoringFindingManager();
  await enforceRateLimit(`monitoring-finding:${organisation.id}:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = z.uuid().parse(String(formData.get("id")));
  const { data, error } = await supabase.from("monitoring_findings")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id).eq("organisation_id", organisation.id)
    .in("status", ["open", "acknowledged"]).select("id").maybeSingle();
  if (error || !data) throw new Error("Finding was not found in this workspace");
  revalidatePath("/app/monitoring");
}

export async function raiseTaskFromFindingAction(formData: FormData) {
  const { supabase, user, organisation } = await requireMonitoringFindingManager();
  await enforceRateLimit(`monitoring-finding:${organisation.id}:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = z.uuid().parse(String(formData.get("id")));
  const { error } = await supabase.rpc("raise_monitoring_finding_task", {
    target_organisation_id: organisation.id,
    target_finding_id: id,
    target_owner_id: user.id,
  });
  if (error && error.code !== "23505") throw new Error("Could not raise the remediation task");
  revalidatePath("/app/monitoring");
}

export type GitHubFindingTransitionActionResult = { ok: boolean; message: string };

export async function transitionGitHubFindingAction(
  formData: FormData,
): Promise<GitHubFindingTransitionActionResult> {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner") {
    return { ok: false, message: "Only workspace Owners can review official GitHub findings." };
  }

  const parsed = githubFindingTransitionSchema.safeParse({
    id: String(formData.get("id")),
    status: String(formData.get("status")),
  });
  if (!parsed.success) return { ok: false, message: "Choose a valid GitHub finding transition." };

  const { data: finding, error: findingError } = await supabase.from("monitoring_findings")
    .select("id,status,finding_origin")
    .eq("id", parsed.data.id)
    .eq("organisation_id", organisation.id)
    .maybeSingle();
  if (findingError || !finding || finding.finding_origin !== "github" || finding.status === "resolved") {
    return { ok: false, message: "Official GitHub finding was not found in this workspace." };
  }

  const { data: provenance, error: provenanceError } = await supabase.from("github_finding_provenance")
    .select("finding_id")
    .eq("finding_id", parsed.data.id)
    .eq("organisation_id", organisation.id)
    .maybeSingle();
  if (provenanceError || !provenance) {
    return { ok: false, message: "Official GitHub finding was not found in this workspace." };
  }
  if (finding.status === parsed.data.status) {
    return { ok: true, message: `GitHub finding is already ${GITHUB_FINDING_TRANSITION_LABEL[parsed.data.status]}.` };
  }

  await enforceRateLimit(`github-finding-transition:${organisation.id}:${user.id}`, { limit: 20, windowMs: 60_000 });
  const { data, error } = await createSupabaseServiceClient().rpc("transition_github_finding_server", {
    target_organisation_id: organisation.id,
    target_actor_id: user.id,
    target_finding_id: parsed.data.id,
    target_status: parsed.data.status,
    target_reason: GITHUB_FINDING_TRANSITION_REASON[parsed.data.status],
  });
  if (error || typeof data !== "boolean") {
    return { ok: false, message: "Could not update the official GitHub finding." };
  }

  revalidatePath("/app/monitoring");
  if (!data) {
    return { ok: true, message: `GitHub finding is already ${GITHUB_FINDING_TRANSITION_LABEL[parsed.data.status]}.` };
  }
  return { ok: true, message: `GitHub finding moved to ${GITHUB_FINDING_TRANSITION_LABEL[parsed.data.status]}.` };
}

// One-click "Run checks now" — the demo/manual equivalent of the hourly cron,
// scoped to just this org. Uses the service client (findings + notifications are
// service-role-insert only) but restricts every query to the caller's org.
export async function runMonitoringNowAction() {
  const { organisation, user } = await requireOperator();
  await enforceRateLimit(`monitoring:${organisation.id}:${user.id}`, { limit: 5, windowMs: 60_000 });
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
