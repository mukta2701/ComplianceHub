"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  retryGitHubMaterialisationJob,
  GITHUB_MATERIALISATION_RETRY_REASON_CODES,
} from "@/features/github/application/github-compliance-control-room";
import {
  buildMaterialisationDependencies,
  reconcileApprovedGitHubObservations,
} from "@/features/github/application/materialise-approved-observations";
import { STANDARD_GITHUB_ISO_MAPPING_PACK } from "@/features/github/domain/mapping";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";

const uuid = z.uuid();
const checksum = z.string().regex(/^[0-9a-f]{64}$/);
const approveSchema = z.object({
  version: z.literal(STANDARD_GITHUB_ISO_MAPPING_PACK.version),
  checksum: z.literal(STANDARD_GITHUB_ISO_MAPPING_PACK.checksum),
  confirmation: z.literal("accepted"),
}).strict();
const revokeSchema = z.object({ approvalId: uuid }).strict();
const targetSchema = z.object({
  repositoryId: uuid,
  collectionRunId: uuid,
  jobId: uuid,
}).strict();
const retrySchema = targetSchema.extend({
  reasonCode: z.enum(GITHUB_MATERIALISATION_RETRY_REASON_CODES),
}).strict();
const entryDecisionSchema = z.object({
  entryId: uuid,
  entryDigest: checksum,
  decision: z.enum(["approved", "rejected"]),
  expectedRevision: z.string().regex(/^(0|[1-9][0-9]*)$/)
    .transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
}).strict();
const publishedPackSchema = z.object({
  id: uuid,
  version: z.literal(STANDARD_GITHUB_ISO_MAPPING_PACK.version),
  checksum,
  published_at: z.string().datetime({ offset: true }),
}).strict();
const approvalRowSchema = z.object({ id: uuid, mapping_pack_id: uuid }).strict();
const effectiveEntryDecisionRowSchema = z.object({
  organisation_id: uuid,
  mapping_pack_id: uuid,
  mapping_entry_id: uuid,
  entry_digest: checksum,
  status: z.enum(["pending", "approved", "rejected"]),
  revision: z.number().int().nonnegative().safe(),
}).strict();
const effectiveEntryForRunSchema = z.object({
  mapping_pack_id: uuid,
  mapping_entry_id: uuid,
  check_id: z.string().min(1).max(120),
  entry_digest: checksum,
  status: z.literal("approved"),
}).strict();
const observationCheckSchema = z.object({ check_id: z.string().min(1).max(120) }).strict();
const runRowSchema = z.object({
  id: uuid,
  organisation_id: uuid,
  installation_id: uuid,
  repository_id: uuid,
  provider_repository_id: z.number().int().positive().safe(),
  status: z.enum(["succeeded", "partial"]),
}).strict();
const jobRowSchema = z.object({
  id: uuid,
  organisation_id: uuid,
  repository_id: uuid,
  collection_run_id: uuid,
  status: z.enum(["pending", "awaiting_approval", "retryable", "completed", "exhausted"]),
}).strict();
const summarySchema = z.object({
  runsConsidered: z.number().int().min(0).max(1),
  materialised: z.number().int().min(0).max(1),
  unchanged: z.number().int().min(0).max(1),
  awaitingApproval: z.number().int().min(0).max(1),
  needsAttention: z.number().int().min(0).max(3),
  alertEventsCreated: z.number().int().min(0).optional(),
  notificationsCreated: z.number().int().min(0).optional(),
}).strict();

type SessionClient = Awaited<ReturnType<typeof requireAppContext>>["supabase"];
export type GitHubControlRoomActionResult = { ok: boolean; message: string };

async function loadExactPublishedPack(supabase: SessionClient) {
  const { data, error } = await supabase.from("github_mapping_packs")
    .select("id,version,checksum,published_at")
    .eq("version", STANDARD_GITHUB_ISO_MAPPING_PACK.version)
    .eq("checksum", STANDARD_GITHUB_ISO_MAPPING_PACK.checksum)
    .not("published_at", "is", null)
    .maybeSingle();
  const parsed = publishedPackSchema.safeParse(data);
  return error || !parsed.success ? null : parsed.data;
}

async function loadActiveApproval(
  supabase: SessionClient,
  organisationId: string,
  approvalId?: string,
) {
  let query = supabase.from("github_mapping_approvals")
    .select("id,mapping_pack_id")
    .eq("organisation_id", organisationId)
    .is("revoked_at", null);
  if (approvalId) query = query.eq("id", approvalId);
  const { data, error } = await query.maybeSingle();
  const parsed = approvalRowSchema.safeParse(data);
  return error || !parsed.success ? null : parsed.data;
}

async function hasApprovedExactEntryForRun(
  supabase: SessionClient,
  organisationId: string,
  collectionRunId: string,
) {
  try {
    const { data: observationValues, error: observationError } = await supabase.from("github_observations")
      .select("check_id")
      .eq("organisation_id", organisationId)
      .eq("collection_run_id", collectionRunId)
      .limit(100);
    const observations = z.array(observationCheckSchema).min(1).max(100).safeParse(observationValues);
    if (observationError || !observations.success) return false;
    const checkIds = [...new Set(observations.data.map(({ check_id }) => check_id))];

    const { data: decisionValues, error: decisionError } = await supabase
      .from("github_effective_mapping_entry_decisions")
      .select("mapping_pack_id,mapping_entry_id,check_id,entry_digest,status")
      .eq("organisation_id", organisationId)
      .eq("status", "approved")
      .in("check_id", checkIds)
      .limit(15);
    const decisions = z.array(effectiveEntryForRunSchema).max(15).safeParse(decisionValues);
    if (decisionError || !decisions.success || decisions.data.length === 0) return false;
    const selectedPackId = decisions.data[0].mapping_pack_id;
    return decisions.data.every((decision) => decision.mapping_pack_id === selectedPackId
      && checkIds.includes(decision.check_id));
  } catch {
    return false;
  }
}

export async function recordGitHubMappingEntryDecisionAction(
  formData: FormData,
): Promise<GitHubControlRoomActionResult> {
  const context = await requireAppContext();
  const monitoringAccess = workspaceAccess(context.membership.role).section("monitoring");
  if (!monitoringAccess.canManageOperation("approve-github-mapping")) {
    return { ok: false, message: monitoringAccess.manageDeniedMessageFor("approve-github-mapping") };
  }

  const parsed = entryDecisionSchema.safeParse({
    entryId: formData.get("entryId"),
    entryDigest: formData.get("entryDigest"),
    decision: formData.get("decision"),
    expectedRevision: formData.get("expectedRevision"),
  });
  if (!parsed.success) return { ok: false, message: "This GitHub check decision is invalid. Refresh the review and try again." };

  let currentValue: unknown;
  let currentError: unknown;
  try {
    const currentResult = await context.supabase
      .from("github_effective_mapping_entry_decisions")
      .select("organisation_id,mapping_pack_id,mapping_entry_id,entry_digest,status,revision")
      .eq("organisation_id", context.organisation.id)
      .eq("mapping_entry_id", parsed.data.entryId)
      .maybeSingle();
    currentValue = currentResult.data;
    currentError = currentResult.error;
  } catch {
    return { ok: false, message: "Could not load the current GitHub check review. Refresh and try again." };
  }
  const current = effectiveEntryDecisionRowSchema.safeParse(currentValue);
  if (currentError || !current.success || current.data.organisation_id !== context.organisation.id
    || current.data.mapping_entry_id !== parsed.data.entryId) {
    return { ok: false, message: "This GitHub check is no longer available in the selected mapping. Refresh the review." };
  }
  if (current.data.entry_digest !== parsed.data.entryDigest) {
    return { ok: false, message: "This GitHub check changed after you opened it. Refresh the review before deciding." };
  }
  if (current.data.revision !== parsed.data.expectedRevision) {
    return { ok: false, message: "The GitHub mapping review changed. Refresh it before deciding." };
  }

  try {
    await enforceRateLimit(`github-mapping-entry-decision:${context.organisation.id}:${context.user.id}`, {
      limit: 30,
      windowMs: 60_000,
    });
    const { data, error } = await createSupabaseServiceClient().rpc(
      "record_github_mapping_entry_decision_server",
      {
        target_organisation_id: context.organisation.id,
        target_actor_id: context.user.id,
        target_mapping_entry_id: parsed.data.entryId,
        target_entry_digest: parsed.data.entryDigest,
        target_decision: parsed.data.decision,
        expected_revision: parsed.data.expectedRevision,
      },
    );
    if (error || !uuid.safeParse(data).success) {
      if (error?.code === "40001" || error?.code === "22023") {
        return { ok: false, message: "The GitHub mapping review changed. Refresh it before deciding." };
      }
      return { ok: false, message: "Could not save this GitHub check decision." };
    }
    revalidatePath("/app/monitoring");
    return {
      ok: true,
      message: parsed.data.decision === "approved" ? "GitHub check approved." : "GitHub check rejected.",
    };
  } catch {
    return { ok: false, message: "Could not save this GitHub check decision." };
  }
}

export async function approveGitHubMappingPackAction(formData: FormData): Promise<GitHubControlRoomActionResult> {
  const context = await requireAppContext();
  const monitoringAccess = workspaceAccess(context.membership.role).section("monitoring");
  if (!monitoringAccess.canManageOperation("approve-github-mapping")) {
    return { ok: false, message: monitoringAccess.manageDeniedMessageFor("approve-github-mapping") };
  }
  const parsed = approveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "Review and confirm the GitHub mapping limitations before approval." };
  }
  const pack = await loadExactPublishedPack(context.supabase);
  if (!pack || pack.version !== parsed.data.version || pack.checksum !== parsed.data.checksum) {
    return { ok: false, message: "The reviewed GitHub mapping version changed. Refresh and review it again." };
  }
  try {
    await enforceRateLimit(`github-mapping-approval:${context.organisation.id}:${context.user.id}`, {
      limit: 5,
      windowMs: 60_000,
    });
    const service = createSupabaseServiceClient();
    const { data, error } = await service.rpc("approve_github_mapping_pack_server", {
      target_organisation_id: context.organisation.id,
      target_actor_id: context.user.id,
      target_version: parsed.data.version,
      target_checksum: parsed.data.checksum,
    });
    if (error || !uuid.safeParse(data).success) throw new Error("approval failed");
    revalidatePath("/app/monitoring");
    return { ok: true, message: "GitHub mapping approved. Official records can now be processed." };
  } catch {
    return { ok: false, message: "Could not approve the GitHub mapping right now." };
  }
}

export async function revokeGitHubMappingApprovalAction(formData: FormData): Promise<GitHubControlRoomActionResult> {
  const context = await requireAppContext();
  const monitoringAccess = workspaceAccess(context.membership.role).section("monitoring");
  if (!monitoringAccess.canManageOperation("revoke-github-mapping")) {
    return { ok: false, message: monitoringAccess.manageDeniedMessageFor("revoke-github-mapping") };
  }
  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Could not revoke this GitHub mapping approval." };
  const approval = await loadActiveApproval(context.supabase, context.organisation.id, parsed.data.approvalId);
  if (!approval) return { ok: false, message: "Could not revoke this GitHub mapping approval." };
  try {
    await enforceRateLimit(`github-mapping-revoke:${context.organisation.id}:${context.user.id}`, {
      limit: 5,
      windowMs: 60_000,
    });
    const service = createSupabaseServiceClient();
    const { data, error } = await service.rpc("revoke_github_mapping_approval_server", {
      target_organisation_id: context.organisation.id,
      target_actor_id: context.user.id,
      target_approval_id: parsed.data.approvalId,
    });
    if (error || data !== true) throw new Error("revocation failed");
    revalidatePath("/app/monitoring");
    return { ok: true, message: "GitHub mapping approval revoked. Existing records remain historical." };
  } catch {
    return { ok: false, message: "Could not revoke this GitHub mapping approval." };
  }
}

async function loadExactTarget(
  supabase: SessionClient,
  organisationId: string,
  target: z.infer<typeof targetSchema>,
) {
  const { data: runValue, error: runError } = await supabase.from("github_collection_runs")
    .select("id,organisation_id,installation_id,repository_id,provider_repository_id,status")
    .eq("id", target.collectionRunId)
    .eq("organisation_id", organisationId)
    .eq("repository_id", target.repositoryId)
    .in("status", ["succeeded", "partial"])
    .maybeSingle();
  const run = runRowSchema.safeParse(runValue);
  if (runError || !run.success) return null;

  const { data: jobValue, error: jobError } = await supabase.from("github_materialisation_jobs")
    .select("id,organisation_id,repository_id,collection_run_id,status")
    .eq("id", target.jobId)
    .eq("organisation_id", organisationId)
    .eq("repository_id", target.repositoryId)
    .eq("collection_run_id", target.collectionRunId)
    .maybeSingle();
  const job = jobRowSchema.safeParse(jobValue);
  if (jobError || !job.success) return null;
  return { run: run.data, job: job.data };
}

export async function processApprovedGitHubResultsAction(formData: FormData): Promise<GitHubControlRoomActionResult> {
  const context = await requireAppContext();
  const monitoringAccess = workspaceAccess(context.membership.role).section("monitoring");
  if (!monitoringAccess.canManageOperation("process-github-results")) {
    return { ok: false, message: monitoringAccess.manageDeniedMessageFor("process-github-results") };
  }
  const parsed = targetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Could not process these GitHub results." };
  const target = await loadExactTarget(context.supabase, context.organisation.id, parsed.data);
  if (!target || !["pending", "awaiting_approval", "retryable"].includes(target.job.status)
    || !await hasApprovedExactEntryForRun(
      context.supabase,
      context.organisation.id,
      target.run.id,
    )) {
    return { ok: false, message: "Could not process these GitHub results." };
  }
  try {
    await enforceRateLimit(`github-materialise:${context.organisation.id}:${context.user.id}`, {
      limit: 5,
      windowMs: 60_000,
    });
    const service = createSupabaseServiceClient();
    const summary = summarySchema.parse(await reconcileApprovedGitHubObservations(
      buildMaterialisationDependencies(service),
      {
        limit: 1,
        terminalRuns: [{
          collectionRunId: target.run.id,
          organisationId: target.run.organisation_id,
          installationId: target.run.installation_id,
          repositoryId: target.run.repository_id,
          providerRepositoryId: target.run.provider_repository_id,
          status: target.run.status,
        }],
      },
    ));
    if (summary.runsConsidered !== 1 || summary.needsAttention > 0 || summary.awaitingApproval > 0) {
      throw new Error("materialisation incomplete");
    }
    revalidatePath("/app/monitoring");
    revalidatePath("/app/evidence");
    revalidatePath("/app");
    return { ok: true, message: `Official GitHub records processed: ${summary.materialised + summary.unchanged} run updated.` };
  } catch {
    return { ok: false, message: "Could not process these GitHub results." };
  }
}

export async function retryExhaustedGitHubMaterialisationAction(formData: FormData): Promise<GitHubControlRoomActionResult> {
  const context = await requireAppContext();
  const monitoringAccess = workspaceAccess(context.membership.role).section("monitoring");
  if (!monitoringAccess.canManageOperation("retry-github-materialisation")) {
    return { ok: false, message: monitoringAccess.manageDeniedMessageFor("retry-github-materialisation") };
  }
  const parsed = retrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Could not queue this GitHub processing retry." };
  const target = await loadExactTarget(context.supabase, context.organisation.id, parsed.data);
  if (!target || target.job.status !== "exhausted") {
    return { ok: false, message: "Could not queue this GitHub processing retry." };
  }
  try {
    await enforceRateLimit(`github-materialise-retry:${context.organisation.id}:${context.user.id}`, {
      limit: 5,
      windowMs: 60_000,
    });
    const queued = await retryGitHubMaterialisationJob(createSupabaseServiceClient, {
      organisationId: context.organisation.id,
      actorId: context.user.id,
      jobId: parsed.data.jobId,
      reasonCode: parsed.data.reasonCode,
    });
    if (!queued) throw new Error("retry unavailable");
    revalidatePath("/app/monitoring");
    return { ok: true, message: "GitHub processing retry queued." };
  } catch {
    return { ok: false, message: "Could not queue this GitHub processing retry." };
  }
}
