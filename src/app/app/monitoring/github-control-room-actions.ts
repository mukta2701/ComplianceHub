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
const publishedPackSchema = z.object({
  id: uuid,
  version: z.literal(STANDARD_GITHUB_ISO_MAPPING_PACK.version),
  checksum,
  published_at: z.string().datetime({ offset: true }),
}).strict();
const approvalRowSchema = z.object({ id: uuid, mapping_pack_id: uuid }).strict();
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

async function requireExactActiveApproval(supabase: SessionClient, organisationId: string) {
  const [pack, approval] = await Promise.all([
    loadExactPublishedPack(supabase),
    loadActiveApproval(supabase, organisationId),
  ]);
  return pack && approval?.mapping_pack_id === pack.id ? approval : null;
}

export async function approveGitHubMappingPackAction(formData: FormData): Promise<GitHubControlRoomActionResult> {
  const context = await requireAppContext();
  if (context.membership.role !== "owner") {
    return { ok: false, message: "Only a workspace Owner can approve GitHub compliance mappings." };
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
  if (context.membership.role !== "owner") {
    return { ok: false, message: "Only a workspace Owner can revoke GitHub compliance mappings." };
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
  if (context.membership.role !== "owner") {
    return { ok: false, message: "Only a workspace Owner can process official GitHub records." };
  }
  const parsed = targetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Could not process these GitHub results." };
  const [approval, target] = await Promise.all([
    requireExactActiveApproval(context.supabase, context.organisation.id),
    loadExactTarget(context.supabase, context.organisation.id, parsed.data),
  ]);
  if (!approval || !target || !["pending", "awaiting_approval", "retryable"].includes(target.job.status)) {
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
  if (context.membership.role !== "owner") {
    return { ok: false, message: "Only a workspace Owner can retry GitHub processing." };
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
