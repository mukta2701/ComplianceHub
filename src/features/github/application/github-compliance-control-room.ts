import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { safeSummary } from "@/features/mcp/domain/safe-summary";

const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
const checksum = z.string().regex(/^[0-9a-f]{64}$/);
const safeIdentifier = z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/);
const safeVersion = z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/);
const severity = z.enum(["low", "medium", "high", "critical"]);
const outcome = z.enum(["pass", "fail", "unknown", "not_applicable"]);

export const GITHUB_MATERIALISATION_RETRY_REASON_CODES = [
  "configuration_corrected",
  "provider_recovered",
  "owner_reviewed",
] as const;
const githubMaterialisationRetryReasonCodeSchema = z.enum(GITHUB_MATERIALISATION_RETRY_REASON_CODES);
const retryInputSchema = z.object({
  organisationId: uuid,
  actorId: uuid,
  jobId: uuid,
  reasonCode: githubMaterialisationRetryReasonCodeSchema,
}).strict();

const inputSchema = z.object({
  organisationId: uuid,
  offset: z.number().int().min(0).max(10_000),
  limit: z.number().int().min(1).max(20),
}).strict();

const approvalSchema = z.object({
  mappingPackId: uuid,
  version: z.string().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  checksum,
  approvedAt: dateTime,
  revoked: z.literal(false),
}).strict();

const collectionSchema = z.object({
  id: uuid,
  status: z.enum(["succeeded", "partial", "failed", "rate_limited"]),
  completedAt: dateTime,
}).strict();

const materialisationJobSchema = z.object({
  id: uuid,
  collectionRunId: uuid,
  status: z.enum(["pending", "awaiting_approval", "retryable", "completed", "exhausted"]),
  attempts: z.number().int().min(0).max(25),
  availableAt: dateTime.nullable(),
  exhaustedAt: dateTime.nullable(),
}).strict().superRefine((job, ctx) => {
  if ((job.status === "exhausted") !== (job.exhaustedAt !== null)) {
    ctx.addIssue({ code: "custom", message: "invalid exhausted job shape" });
  }
  if (job.status === "exhausted" && job.attempts !== 25) {
    ctx.addIssue({ code: "custom", message: "invalid exhausted attempt count" });
  }
  if ((job.status === "awaiting_approval") !== (job.availableAt === null)) {
    ctx.addIssue({ code: "custom", message: "invalid job availability" });
  }
});

const officialResultSchema = z.object({
  id: uuid,
  checkId: safeIdentifier,
  outcome,
  severity: severity.nullable(),
  summary: z.string().min(1).max(280),
  observedAt: dateTime,
  freshUntil: dateTime,
  materialisedAt: dateTime,
  ruleVersion: safeVersion,
  mappingPackId: uuid,
  mappingVersion: z.string().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  mappingChecksum: checksum,
  evidenceId: uuid.nullable(),
  findingId: uuid.nullable(),
}).strict().superRefine((result, ctx) => {
  if ((result.outcome === "fail") !== (result.severity !== null)) {
    ctx.addIssue({ code: "custom", message: "severity must match failure outcome" });
  }
  if (result.outcome === "fail" && (result.findingId === null || result.evidenceId !== null)) {
    ctx.addIssue({ code: "custom", message: "failure reference shape is invalid" });
  }
  if (result.outcome === "pass" && result.evidenceId === null) {
    ctx.addIssue({ code: "custom", message: "pass result requires evidence" });
  }
  if ((result.outcome === "unknown" || result.outcome === "not_applicable")
    && (result.evidenceId !== null || result.findingId !== null)) {
    ctx.addIssue({ code: "custom", message: "non-material result cannot expose references" });
  }
  if (Date.parse(result.freshUntil) <= Date.parse(result.observedAt)
    || Date.parse(result.materialisedAt) < Date.parse(result.observedAt)) {
    ctx.addIssue({ code: "custom", message: "invalid result chronology" });
  }
  if (safeSummary(result.summary, 280, "GitHub compliance result") !== result.summary) {
    ctx.addIssue({ code: "custom", message: "unsafe summary" });
  }
});

const repositorySchema = z.object({
  id: uuid,
  name: z.string().min(3).max(141),
  url: z.string().min(1).max(300),
  visibility: z.enum(["public", "private", "internal"]),
  defaultBranch: z.string().min(1).max(255).regex(/^[A-Za-z0-9._\/-]+$/),
  archived: z.boolean(),
  available: z.boolean(),
  latestCollection: collectionSchema.nullable(),
  latestMaterialisationJob: materialisationJobSchema.nullable(),
  officialResults: z.array(officialResultSchema).max(20),
}).strict();

const exhaustedAttentionItemSchema = z.object({
  jobId: uuid,
  repositoryId: uuid,
  collectionRunId: uuid,
  attempts: z.number().int().min(0).max(25),
  exhaustedAt: dateTime,
}).strict();

const controlRoomSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: uuid,
  asOf: dateTime,
  approval: approvalSchema.nullable(),
  pagination: z.object({
    offset: z.number().int().min(0).max(10_000),
    limit: z.number().int().min(1).max(20),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict(),
  repositories: z.array(repositorySchema).max(20),
  exhaustedAttention: z.object({
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
    items: z.array(exhaustedAttentionItemSchema).max(20),
  }).strict(),
}).strict();

export type GitHubComplianceControlRoom = z.infer<typeof controlRoomSchema>;
export type GitHubComplianceControlRoomInput = z.infer<typeof inputSchema>;
export type GitHubMaterialisationRetryReasonCode = z.infer<typeof githubMaterialisationRetryReasonCodeSchema>;
export type SafeGitHubRepositorySource = { name: string; url: string };

export const CONTROL_ROOM_REQUEST_TIMEOUT_MS = 7_000;
const LOAD_ERROR = "Could not load GitHub compliance control room";
const RETRY_ERROR = "Could not retry GitHub materialisation job";

function fail(): never {
  throw new Error(LOAD_ERROR);
}

function retryFail(): never {
  throw new Error(RETRY_ERROR);
}

export async function retryGitHubMaterialisationJob(
  createServiceClient: () => Pick<SupabaseClient, "rpc">,
  input: unknown,
): Promise<boolean> {
  const parsed = retryInputSchema.safeParse(input);
  if (!parsed.success) retryFail();

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("retry_github_materialisation_job_server", {
      target_organisation_id: parsed.data.organisationId,
      target_actor_id: parsed.data.actorId,
      target_job_id: parsed.data.jobId,
      target_reason: parsed.data.reasonCode,
    });
    if (error || typeof data !== "boolean") retryFail();
    return data;
  } catch {
    retryFail();
  }
}

export function parseSafeGitHubRepositorySource(
  source: SafeGitHubRepositorySource,
): SafeGitHubRepositorySource {
  const nameMatch = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]{1,100})$/.exec(source.name);
  if (!nameMatch || nameMatch[2] === "." || nameMatch[2] === ".." || source.url.includes("%")) {
    throw new Error("Invalid GitHub repository source");
  }

  const canonicalUrl = `https://github.com/${source.name}`;
  if (source.url !== canonicalUrl && source.url !== `${canonicalUrl}/`) {
    throw new Error("Invalid GitHub repository source");
  }

  let parsed: URL;
  try {
    parsed = new URL(source.url);
  } catch {
    throw new Error("Invalid GitHub repository source");
  }
  const canonicalPath = `/${source.name}`;
  if (parsed.protocol !== "https:"
    || parsed.hostname !== "github.com"
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
    || (parsed.pathname !== canonicalPath && parsed.pathname !== `${canonicalPath}/`)) {
    throw new Error("Invalid GitHub repository source");
  }
  return { name: source.name, url: canonicalUrl };
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function parseGitHubComplianceControlRoom(
  value: unknown,
  input: GitHubComplianceControlRoomInput,
): GitHubComplianceControlRoom {
  const expected = inputSchema.safeParse(input);
  const parsed = controlRoomSchema.safeParse(value);
  if (!expected.success || !parsed.success) fail();

  const room = parsed.data;
  const asOf = Date.parse(room.asOf);
  const pagination = room.pagination;
  if (room.workspaceId !== expected.data.organisationId
    || pagination.offset !== expected.data.offset
    || pagination.limit !== expected.data.limit
    || room.repositories.length > pagination.limit
    || pagination.truncated !== (pagination.offset + room.repositories.length < pagination.total)
    || hasDuplicates(room.repositories.map((repository) => repository.id))
    || room.exhaustedAttention.truncated !== (room.exhaustedAttention.total > room.exhaustedAttention.items.length)
    || hasDuplicates(room.exhaustedAttention.items.map((item) => item.jobId))) {
    fail();
  }
  if (room.approval && Date.parse(room.approval.approvedAt) > asOf) fail();

  const repositories = room.repositories.map((repository) => {
    let source: SafeGitHubRepositorySource;
    try {
      source = parseSafeGitHubRepositorySource(repository);
    } catch {
      fail();
    }
    if (repository.latestCollection && Date.parse(repository.latestCollection.completedAt) > asOf) fail();
    if (repository.latestMaterialisationJob) {
      const job = repository.latestMaterialisationJob;
      if (job.exhaustedAt !== null && Date.parse(job.exhaustedAt) > asOf) fail();
    }
    if (hasDuplicates(repository.officialResults.map((result) => result.checkId))) fail();
    if (repository.officialResults.some((result) => Date.parse(result.materialisedAt) > asOf)) fail();
    return { ...repository, ...source };
  });

  if (room.exhaustedAttention.items.some((item) => Date.parse(item.exhaustedAt) > asOf)) fail();
  return { ...room, repositories };
}

export async function loadGitHubComplianceControlRoom(
  supabase: SupabaseClient,
  input: GitHubComplianceControlRoomInput,
): Promise<GitHubComplianceControlRoom> {
  const parsedInput = inputSchema.safeParse(input);
  if (!parsedInput.success) fail();

  try {
    const { data, error } = await supabase.rpc("get_github_compliance_control_room_v1", {
      target_organisation_id: parsedInput.data.organisationId,
      target_offset: parsedInput.data.offset,
      target_limit: parsedInput.data.limit,
    }).abortSignal(AbortSignal.timeout(CONTROL_ROOM_REQUEST_TIMEOUT_MS));
    if (error || data === null) fail();
    return parseGitHubComplianceControlRoom(data, parsedInput.data);
  } catch {
    fail();
  }
}
