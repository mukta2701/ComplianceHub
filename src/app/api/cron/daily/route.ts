import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/security/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runDailySweep, type SweepDependencies } from "@/features/automation/application/daily-sweep";
import { memoizeOwners } from "@/features/automation/application/owner-resolver";
import type { SweepEvidence, SweepPolicy, SweepTask } from "@/features/automation/domain/sweep";
import { collectEvidence } from "@/features/integrations/application/collect-run";
import { syncTickets } from "@/features/integrations/application/sync-run";
import { logError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Run a named stage in isolation: a failure is logged and turned into an error
// marker instead of aborting the whole sweep, so one bad stage can't starve the
// others (evidence ageing + notifications must still run even if collect fails).
async function stage<T>(name: string, run: () => Promise<T>): Promise<T | { error: string }> {
  try { return await run(); }
  catch (error) { await logError("cron", `daily cron stage "${name}" failed`, error); return { error: `${name} failed` }; }
}

async function sweep(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  // Order matters: collect fresh evidence, then sync ticket statuses, then
  // sweep (age evidence, raise tasks, notify). Each stage is isolated so a
  // failure is reported, not fatal.
  const collectResult = await stage("collect", () => collectEvidence(supabase));
  const syncResult = await stage("sync", () => syncTickets(supabase));
  const today = new Date().toISOString().slice(0, 10);
  // Memoized so each organisation's owners are fetched at most once per sweep
  // run, instead of once per task/policy row (an N+1 at real tenant scale).
  const resolveOwners = memoizeOwners(async (organisationId) => {
    const { data, error } = await supabase.from("memberships")
      .select("user_id").eq("organisation_id", organisationId).eq("role", "owner");
    if (error) throw error;
    return (data ?? []).map((row) => row.user_id as string);
  });
  const deps: SweepDependencies = {
    today,
    listActiveEvidence: async () => {
      const { data, error } = await supabase.from("evidence")
        .select("id,organisation_id,title,owner_id,status,valid_until")
        .in("status", ["current", "expiring", "expired"]).not("valid_until", "is", null);
      if (error) throw error;
      return (data ?? []).map((row): SweepEvidence => ({
        id: row.id, organisationId: row.organisation_id, title: row.title, ownerId: row.owner_id,
        status: row.status as "current" | "expiring" | "expired", validUntil: row.valid_until,
      }));
    },
    updateEvidenceStatus: async (id, status) => {
      const { error } = await supabase.from("evidence").update({ status }).eq("id", id);
      if (error) throw error;
    },
    listOpenExpiryTaskEvidenceIds: async () => {
      const { data, error } = await supabase.from("tasks").select("evidence_id")
        .eq("source", "evidence_expiry").in("status", ["open", "in_progress"]).not("evidence_id", "is", null);
      if (error) throw error;
      return (data ?? []).map((row) => row.evidence_id as string);
    },
    createTask: async (task) => {
      const owners = await resolveOwners(task.organisationId);
      if (owners.length === 0) return false; // an org with no owner can't be assigned a creator — skip, don't abort
      const { data, error } = await supabase.from("tasks").upsert({
        organisation_id: task.organisationId, title: task.title,
        detail: "Raised automatically because linked evidence is expiring or expired.",
        source: "evidence_expiry", owner_id: task.ownerId, due_on: task.dueOn,
        evidence_id: task.evidenceId, created_by: owners[0],
      }, { onConflict: "organisation_id,evidence_id,source", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      return Boolean(data?.length);
    },
    listOverdueTasks: async () => {
      const { data, error } = await supabase.from("tasks")
        .select("id,organisation_id,title,owner_id,status,due_on")
        .in("status", ["open", "in_progress"]).lt("due_on", today);
      if (error) throw error;
      return (data ?? []).map((row): SweepTask => ({
        id: row.id, organisationId: row.organisation_id, title: row.title, ownerId: row.owner_id,
        status: row.status, dueOn: row.due_on,
      }));
    },
    listReviewablePolicies: async () => {
      const { data, error } = await supabase.from("policies")
        .select("id,organisation_id,reference,title,owner_id,review_due")
        .eq("status", "approved").not("review_due", "is", null);
      if (error) throw error;
      return (data ?? []).map((row): SweepPolicy => ({
        id: row.id, organisationId: row.organisation_id, reference: row.reference,
        title: row.title, ownerId: row.owner_id, reviewDue: row.review_due,
      }));
    },
    listOpenPolicyReviewTaskPolicyIds: async () => {
      const { data, error } = await supabase.from("tasks").select("policy_id")
        .eq("source", "policy_review").in("status", ["open", "in_progress"]).not("policy_id", "is", null);
      if (error) throw error;
      return (data ?? []).map((row) => row.policy_id as string);
    },
    createPolicyReviewTask: async (task) => {
      const owners = await resolveOwners(task.organisationId);
      if (owners.length === 0) return false; // an org with no owner can't be assigned a creator — skip, don't abort
      const { data, error } = await supabase.from("tasks").upsert({
        organisation_id: task.organisationId,
        title: `Review policy ${task.reference}: ${task.title}`.slice(0, 200),
        detail: "Raised automatically because this policy has reached its scheduled review date.",
        source: "policy_review", owner_id: task.ownerId, due_on: task.dueOn,
        policy_id: task.policyId, created_by: owners[0],
      }, { onConflict: "organisation_id,policy_id,source", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      return Boolean(data?.length);
    },
    listOrganisationOwners: (organisationId) => resolveOwners(organisationId),
    createNotification: async (notification) => {
      // The full day-scoped constraint makes retries and concurrent runs idempotent.
      const { data, error } = await supabase.from("notifications").upsert({
        organisation_id: notification.organisationId, user_id: notification.userId, kind: notification.kind,
        subject_type: notification.subjectType, subject_id: notification.subjectId, message: notification.message, sweep_on: notification.sweepOn,
      }, { onConflict: "user_id,kind,subject_type,subject_id,sweep_on", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      return Boolean(data?.length);
    },
  };
  const summary = await stage("sweep", () => runDailySweep(deps));
  return NextResponse.json({ collect: collectResult, sync: syncResult, sweep: summary });
}

export async function GET(request: Request) { return sweep(request); } // Vercel Cron sends GET
export async function POST(request: Request) { return sweep(request); }
