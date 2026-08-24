import "server-only";

import { z } from "zod";

import {
  STANDARD_GITHUB_ISO_MAPPING_PACK,
  selectGitHubObservationTreatment,
} from "../domain/mapping";
import type { GitHubObservation } from "../domain/observation";
import { EXPECTED_GITHUB_CHECK_IDS, RULE_PACK_VERSION } from "../domain/rules";

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const safeCountSchema = z.number().int().nonnegative().max(100);

const terminalRunSchema = z.object({
  runId: uuidSchema,
  organisationId: uuidSchema,
  installationId: uuidSchema,
  repositoryId: uuidSchema,
  providerRepositoryId: z.number().int().positive().safe(),
  status: z.enum(["succeeded", "partial"]),
  observationCount: z.literal(EXPECTED_GITHUB_CHECK_IDS.length),
  repositoryOwner: z.string().min(1).max(100),
  repositoryName: z.string().min(1).max(100),
  repositorySourceUrl: z.string().url().max(500),
}).strict();

const activeApprovalSchema = z.object({
  approvalId: uuidSchema,
  mappingPackId: uuidSchema,
  version: z.string().min(1).max(80),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: dateTimeSchema.nullable(),
}).strict();

const diagnosticCodeSchema = z.enum([
  "permission_denied",
  "feature_unavailable",
  "not_found",
  "rate_limited",
  "provider_unavailable",
  "invalid_response",
]);
const UNKNOWN_REMEDIATION = "Restore the required GitHub App permission or feature, then run collection again.";

const observationRowSchema = z.object({
  id: uuidSchema,
  organisation_id: uuidSchema,
  installation_id: uuidSchema,
  repository_id: uuidSchema,
  collection_run_id: uuidSchema,
  provider_repository_id: z.number().int().positive().safe(),
  observation_key: z.string().min(1).max(500),
  check_id: z.string().min(1).max(120),
  rule_version: z.string().min(1).max(120),
  subject_type: z.literal("github_repository"),
  subject_id: z.string().min(1).max(200),
  result: z.enum(["pass", "fail", "unknown", "not_applicable"]),
  severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
  title: z.string().min(1).max(300),
  explanation: z.string().min(1).max(5_000),
  remediation: z.string().min(1).max(5_000).nullable(),
  observed_at: dateTimeSchema,
  fresh_until: dateTimeSchema,
  source_url: z.string().url().max(1_000).refine((value) => value.startsWith("https://")),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  diagnostic_code: diagnosticCodeSchema.nullable(),
}).strict().superRefine((row, context) => {
  if (new Date(row.fresh_until).getTime() <= new Date(row.observed_at).getTime()) {
    context.addIssue({ code: "custom", path: ["fresh_until"], message: "Observation freshness is invalid" });
  }
  if ((row.result === "unknown") !== (row.diagnostic_code !== null)) {
    context.addIssue({ code: "custom", path: ["diagnostic_code"], message: "Observation diagnostic is invalid" });
  }
  if (row.result === "pass" && (row.severity !== null || row.remediation !== null)) {
    context.addIssue({ code: "custom", path: ["result"], message: "Passing observation semantics are invalid" });
  }
  if (row.result === "fail" && (row.severity === null || row.remediation === null || row.diagnostic_code !== null)) {
    context.addIssue({ code: "custom", path: ["result"], message: "Failed observation semantics are invalid" });
  }
  if (row.result === "unknown" && (row.severity !== null || row.remediation !== UNKNOWN_REMEDIATION)) {
    context.addIssue({ code: "custom", path: ["result"], message: "Unknown observation semantics are invalid" });
  }
  if (row.result === "not_applicable" && (row.severity !== null || row.remediation !== null || row.diagnostic_code !== null)) {
    context.addIssue({ code: "custom", path: ["result"], message: "Not-applicable observation semantics are invalid" });
  }
});

const rpcSummarySchema = z.object({
  evidence_created: safeCountSchema,
  evidence_refreshed: safeCountSchema,
  findings_created: safeCountSchema,
  findings_refreshed: safeCountSchema,
  findings_reopened: safeCountSchema,
  findings_resolved: safeCountSchema,
  skipped: safeCountSchema,
}).strict();

export type MaterialisationDecision = {
  observation_id: string;
  treatment_kind: "evidence" | "finding" | "explanatory";
  iso_control_references: string[];
  failure_severity: "low" | "medium" | "high" | "critical";
  remediation: string;
};

export type MaterialisationRpcInput = {
  target_organisation_id: string;
  target_collection_run_id: string;
  target_mapping_version: string;
  target_mapping_checksum: string;
  target_decisions: MaterialisationDecision[];
};

export type ReconciliationScope = {
  limit: number;
  terminalRuns?: Array<{
    collectionRunId: string;
    organisationId: string;
    installationId: string;
    repositoryId: string;
    providerRepositoryId: number;
    status: "succeeded" | "partial";
  }>;
};

type ClaimedMaterialisationJob = {
  jobId: string;
  leaseToken: string;
  attemptCount: number;
  collectionRunId: string;
  organisationId: string;
};

type MaterialisationJobOutcome = "completed" | "awaiting_approval" | "retryable";

export type MaterialisationDependencies = {
  claimJobs(scope: { limit: number; collectionRunIds?: string[] }): Promise<unknown[]>;
  finaliseJob(job: Pick<ClaimedMaterialisationJob, "jobId" | "leaseToken" | "attemptCount"> & { outcome: MaterialisationJobOutcome }): Promise<boolean>;
  loadTerminalRun(target: { organisationId: string; collectionRunId: string }): Promise<unknown | null>;
  loadActiveApproval(organisationId: string): Promise<unknown | null>;
  loadObservations(target: { organisationId: string; collectionRunId: string }): Promise<unknown[]>;
  materialise(input: MaterialisationRpcInput): Promise<{ data: unknown; error: unknown }>;
};

export type MaterialisationOutcome =
  | { status: "awaiting_approval" | "not_terminal" | "stale_approval" | "invalid_data" | "permission_denied" | "retryable_failure"; collectionRunId: string }
  | {
    status: "materialised" | "unchanged";
    collectionRunId: string;
    runStatus: "succeeded" | "partial";
    evidenceCreated: number;
    evidenceRefreshed: number;
    findingsCreated: number;
    findingsRefreshed: number;
    findingsReopened: number;
    findingsResolved: number;
    skipped: number;
  };

export type ReconciliationSummary = {
  runsConsidered: number;
  materialised: number;
  unchanged: number;
  awaitingApproval: number;
  needsAttention: number;
};

type QueryResult = { data: unknown; error: unknown };
type QueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  in(column: string, values: unknown[]): QueryBuilder;
  is(column: string, value: null): QueryBuilder;
  not(column: string, operator: "is", value: null): QueryBuilder;
  gte(column: string, value: string): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};
type SupabaseServiceClient = {
  from(table: string): QueryBuilder;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
};

const rawRunSchema = z.object({
  id: uuidSchema,
  organisation_id: uuidSchema,
  installation_id: uuidSchema,
  repository_id: uuidSchema,
  status: z.enum(["succeeded", "partial"]),
  observation_count: z.literal(EXPECTED_GITHUB_CHECK_IDS.length),
  github_repositories: z.object({
    provider_repository_id: z.number().int().positive().safe(),
    owner_login: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    html_url: z.string().url().max(500),
  }).strict(),
}).strict();
const rawApprovalSchema = z.object({
  id: uuidSchema,
  mapping_pack_id: uuidSchema,
  github_mapping_packs: z.object({
    id: uuidSchema,
    version: z.string().min(1).max(80),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    published_at: dateTimeSchema,
  }).strict(),
}).strict();
const scopeSchema = z.object({
  limit: z.number().int().min(1).max(100),
  terminalRuns: z.array(z.object({
    collectionRunId: uuidSchema,
    organisationId: uuidSchema,
    installationId: uuidSchema,
    repositoryId: uuidSchema,
    providerRepositoryId: z.number().int().positive().safe(),
    status: z.enum(["succeeded", "partial"]),
  }).strict()).max(10_000).optional(),
}).strict();
const claimedJobSchema = z.object({
  jobId: uuidSchema,
  leaseToken: uuidSchema,
  attemptCount: z.number().int().min(1).max(25),
  collectionRunId: uuidSchema,
  organisationId: uuidSchema,
}).strict();
const rawClaimedJobSchema = z.object({
  job_id: uuidSchema,
  lease_token: uuidSchema,
  attempt_count: z.number().int().min(1).max(25),
  collection_run_id: uuidSchema,
  organisation_id: uuidSchema,
}).strict();

function persistenceFailure(): Error {
  return new Error("GitHub compliance materialisation persistence failed");
}

function parseRawRun(value: unknown): z.infer<typeof terminalRunSchema> {
  const run = rawRunSchema.safeParse(value);
  if (!run.success) throw persistenceFailure();
  return {
    runId: run.data.id,
    organisationId: run.data.organisation_id,
    installationId: run.data.installation_id,
    repositoryId: run.data.repository_id,
    providerRepositoryId: run.data.github_repositories.provider_repository_id,
    status: run.data.status,
    observationCount: run.data.observation_count,
    repositoryOwner: run.data.github_repositories.owner_login,
    repositoryName: run.data.github_repositories.name,
    repositorySourceUrl: run.data.github_repositories.html_url,
  };
}

export function buildMaterialisationDependencies(serviceInput: unknown): MaterialisationDependencies {
  const service = serviceInput as SupabaseServiceClient;
  return {
    async claimJobs(scope) {
      const parsed = z.object({
        limit: z.number().int().min(1).max(100),
        collectionRunIds: z.array(uuidSchema).min(1).max(100).optional(),
      }).strict().safeParse(scope);
      if (!parsed.success || (parsed.data.collectionRunIds && new Set(parsed.data.collectionRunIds).size !== parsed.data.collectionRunIds.length)) {
        throw persistenceFailure();
      }
      const { data, error } = await service.rpc("claim_github_materialisation_jobs_server", {
        target_limit: parsed.data.limit,
        target_collection_run_ids: parsed.data.collectionRunIds ?? null,
      });
      const rows = z.array(rawClaimedJobSchema).max(parsed.data.limit).safeParse(data);
      if (error || !rows.success) throw persistenceFailure();
      return rows.data.map((row) => ({
        jobId: row.job_id,
        leaseToken: row.lease_token,
        attemptCount: row.attempt_count,
        collectionRunId: row.collection_run_id,
        organisationId: row.organisation_id,
      }));
    },
    async finaliseJob(job) {
      const parsed = claimedJobSchema.pick({ jobId: true, leaseToken: true, attemptCount: true })
        .extend({ outcome: z.enum(["completed", "awaiting_approval", "retryable"]) }).strict().safeParse(job);
      if (!parsed.success) throw persistenceFailure();
      const { data, error } = await service.rpc("finalize_github_materialisation_job_server", {
        target_job_id: parsed.data.jobId,
        target_lease_token: parsed.data.leaseToken,
        target_attempt_count: parsed.data.attemptCount,
        target_outcome: parsed.data.outcome,
      });
      if (error || typeof data !== "boolean") throw persistenceFailure();
      return data;
    },
    async loadTerminalRun(target) {
      const { data, error } = await service.from("github_collection_runs")
        .select("id,organisation_id,installation_id,repository_id,status,observation_count,github_repositories!github_collection_runs_provider_repository_tenant_fk(provider_repository_id,owner_login,name,html_url)")
        .eq("id", target.collectionRunId)
        .eq("organisation_id", target.organisationId)
        .in("status", ["succeeded", "partial"])
        .not("completed_at", "is", null)
        .maybeSingle();
      if (error) throw persistenceFailure();
      return data === null ? null : parseRawRun(data);
    },
    async loadActiveApproval(organisationId) {
      const { data, error } = await service.from("github_mapping_approvals")
        .select("id,mapping_pack_id,github_mapping_packs!inner(id,version,checksum,published_at)")
        .eq("organisation_id", organisationId)
        .is("revoked_at", null)
        .not("github_mapping_packs.published_at", "is", null)
        .maybeSingle();
      if (error) throw persistenceFailure();
      if (data === null) return null;
      const approval = rawApprovalSchema.safeParse(data);
      if (!approval.success || approval.data.github_mapping_packs.id !== approval.data.mapping_pack_id) {
        throw persistenceFailure();
      }
      return {
        approvalId: approval.data.id,
        mappingPackId: approval.data.mapping_pack_id,
        version: approval.data.github_mapping_packs.version,
        checksum: approval.data.github_mapping_packs.checksum,
        publishedAt: approval.data.github_mapping_packs.published_at,
      };
    },
    async loadObservations(target) {
      const { data, error } = await service.from("github_observations")
        .select("id,organisation_id,installation_id,repository_id,collection_run_id,provider_repository_id,observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code")
        .eq("organisation_id", target.organisationId)
        .eq("collection_run_id", target.collectionRunId)
        .order("check_id", { ascending: true })
        .order("id", { ascending: true })
        .limit(100);
      if (error || !Array.isArray(data)) throw persistenceFailure();
      return data;
    },
    async materialise(input) {
      const { data, error } = await service.rpc("materialise_github_observations_server", input);
      return { data, error };
    },
  };
}

function failureStatus(error: unknown): "permission_denied" | "retryable_failure" {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "42501") {
    return "permission_denied";
  }
  return "retryable_failure";
}

function toObservation(row: z.infer<typeof observationRowSchema>): GitHubObservation {
  return {
    observationKey: row.observation_key,
    runId: row.collection_run_id,
    repositoryId: row.provider_repository_id,
    checkId: row.check_id,
    ruleVersion: row.rule_version,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    result: row.result,
    severity: row.severity,
    title: row.title,
    explanation: row.explanation,
    remediation: row.remediation,
    observedAt: row.observed_at,
    freshUntil: row.fresh_until,
    sourceUrl: row.source_url,
    fingerprint: row.fingerprint,
    diagnosticCode: row.diagnostic_code,
  };
}

function mapDecisions(rows: unknown[], run: z.infer<typeof terminalRunSchema>): MaterialisationDecision[] | null {
  const parsed = z.array(observationRowSchema).safeParse(rows);
  if (
    !parsed.success
    || run.observationCount !== EXPECTED_GITHUB_CHECK_IDS.length
    || parsed.data.length !== EXPECTED_GITHUB_CHECK_IDS.length
  ) return null;

  const observationIds = new Set<string>();
  const checkIds = new Set<string>();
  const expectedCheckIds = new Set<string>(EXPECTED_GITHUB_CHECK_IDS);
  const subjectId = `${run.repositoryOwner}/${run.repositoryName}`;
  const ordered = [...parsed.data].sort((left, right) => {
    if (left.check_id < right.check_id) return -1;
    if (left.check_id > right.check_id) return 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const decisions: MaterialisationDecision[] = [];

  try {
    for (const row of ordered) {
      if (
        row.collection_run_id !== run.runId
        || row.organisation_id !== run.organisationId
        || row.installation_id !== run.installationId
        || row.repository_id !== run.repositoryId
        || row.provider_repository_id !== run.providerRepositoryId
        || row.rule_version !== RULE_PACK_VERSION
        || row.subject_id !== subjectId
        || row.source_url !== run.repositorySourceUrl
        || row.observation_key !== `${subjectId}/${row.check_id}/${RULE_PACK_VERSION}`
        || !expectedCheckIds.has(row.check_id)
        || observationIds.has(row.id)
        || checkIds.has(row.check_id)
      ) return null;
      observationIds.add(row.id);
      checkIds.add(row.check_id);
      const treatment = selectGitHubObservationTreatment(
        STANDARD_GITHUB_ISO_MAPPING_PACK,
        toObservation(row),
      );
      if (
        row.result === "fail"
        && (row.severity !== treatment.failureSeverity || row.remediation !== treatment.remediation)
      ) return null;
      decisions.push({
        observation_id: row.id,
        treatment_kind: treatment.kind,
        iso_control_references: [...treatment.isoControlReferences],
        failure_severity: treatment.failureSeverity,
        remediation: treatment.remediation,
      });
    }
  } catch {
    return null;
  }

  return decisions;
}

export async function materialiseApprovedGitHubObservations(
  deps: MaterialisationDependencies,
  target: { organisationId: string; collectionRunId: string },
): Promise<MaterialisationOutcome> {
  const parsedTarget = z.object({ organisationId: uuidSchema, collectionRunId: uuidSchema }).strict().safeParse(target);
  if (!parsedTarget.success) return { status: "invalid_data", collectionRunId: target.collectionRunId };

  let runValue: unknown | null;
  try {
    runValue = await deps.loadTerminalRun(target);
  } catch {
    return { status: "retryable_failure", collectionRunId: target.collectionRunId };
  }
  if (runValue === null) return { status: "not_terminal", collectionRunId: target.collectionRunId };
  const parsedRun = terminalRunSchema.safeParse(runValue);
  if (!parsedRun.success || parsedRun.data.organisationId !== target.organisationId || parsedRun.data.runId !== target.collectionRunId) {
    return { status: "invalid_data", collectionRunId: target.collectionRunId };
  }
  if (parsedRun.data.repositorySourceUrl !== `https://github.com/${parsedRun.data.repositoryOwner}/${parsedRun.data.repositoryName}`) {
    return { status: "invalid_data", collectionRunId: target.collectionRunId };
  }

  let approvalValue: unknown | null;
  try {
    approvalValue = await deps.loadActiveApproval(target.organisationId);
  } catch {
    return { status: "retryable_failure", collectionRunId: target.collectionRunId };
  }
  if (approvalValue === null) return { status: "awaiting_approval", collectionRunId: target.collectionRunId };
  const parsedApproval = activeApprovalSchema.safeParse(approvalValue);
  if (!parsedApproval.success) return { status: "invalid_data", collectionRunId: target.collectionRunId };
  if (
    parsedApproval.data.publishedAt === null
    || parsedApproval.data.version !== STANDARD_GITHUB_ISO_MAPPING_PACK.version
    || parsedApproval.data.checksum !== STANDARD_GITHUB_ISO_MAPPING_PACK.checksum
  ) return { status: "stale_approval", collectionRunId: target.collectionRunId };

  let rows: unknown[];
  try {
    rows = await deps.loadObservations(target);
  } catch {
    return { status: "retryable_failure", collectionRunId: target.collectionRunId };
  }
  const decisions = mapDecisions(rows, parsedRun.data);
  if (!decisions) return { status: "invalid_data", collectionRunId: target.collectionRunId };

  let rpcResult: { data: unknown; error: unknown };
  try {
    rpcResult = await deps.materialise({
      target_organisation_id: target.organisationId,
      target_collection_run_id: target.collectionRunId,
      target_mapping_version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      target_mapping_checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      target_decisions: decisions,
    });
  } catch {
    return { status: "retryable_failure", collectionRunId: target.collectionRunId };
  }
  if (rpcResult.error) return { status: failureStatus(rpcResult.error), collectionRunId: target.collectionRunId };
  const parsedSummary = rpcSummarySchema.safeParse(rpcResult.data);
  if (!parsedSummary.success) return { status: "retryable_failure", collectionRunId: target.collectionRunId };

  const summary = parsedSummary.data;
  const changed = summary.evidence_created
    + summary.evidence_refreshed
    + summary.findings_created
    + summary.findings_refreshed
    + summary.findings_reopened
    + summary.findings_resolved;
  return {
    status: changed > 0 ? "materialised" : "unchanged",
    collectionRunId: target.collectionRunId,
    runStatus: parsedRun.data.status,
    evidenceCreated: summary.evidence_created,
    evidenceRefreshed: summary.evidence_refreshed,
    findingsCreated: summary.findings_created,
    findingsRefreshed: summary.findings_refreshed,
    findingsReopened: summary.findings_reopened,
    findingsResolved: summary.findings_resolved,
    skipped: summary.skipped,
  };
}

export async function reconcileApprovedGitHubObservations(
  deps: MaterialisationDependencies,
  scope: ReconciliationScope,
): Promise<ReconciliationSummary> {
  const empty: ReconciliationSummary = {
    runsConsidered: 0,
    materialised: 0,
    unchanged: 0,
    awaitingApproval: 0,
    needsAttention: 0,
  };
  const parsedScope = scopeSchema.safeParse(scope);
  if (!parsedScope.success) return { ...empty, needsAttention: 1 };
  const references = parsedScope.data.terminalRuns;
  const ids = references?.map((reference) => reference.collectionRunId);
  if (ids && new Set(ids).size !== ids.length) return { ...empty, needsAttention: 1 };
  const claimScopes = ids
    ? Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ({
        limit: Math.min(100, ids.length - index * 100),
        collectionRunIds: ids.slice(index * 100, index * 100 + 100),
      }))
    : [{ limit: parsedScope.data.limit }];

  for (const claimScope of claimScopes) {
    let values: unknown[];
    try {
      values = await deps.claimJobs(claimScope);
    } catch {
      empty.needsAttention += 1;
      continue;
    }
    if (!Array.isArray(values) || values.length > claimScope.limit) {
      empty.needsAttention += 1;
      continue;
    }
    for (const value of values) {
      const job = claimedJobSchema.safeParse(value);
      if (!job.success) {
        empty.needsAttention += 1;
        continue;
      }
      empty.runsConsidered += 1;
      const outcome = await materialiseApprovedGitHubObservations(deps, {
        organisationId: job.data.organisationId,
        collectionRunId: job.data.collectionRunId,
      });
      const jobOutcome: MaterialisationJobOutcome = outcome.status === "materialised" || outcome.status === "unchanged"
        ? "completed"
        : outcome.status === "awaiting_approval"
          ? "awaiting_approval"
          : "retryable";
      let finalised = false;
      try {
        finalised = await deps.finaliseJob({
          jobId: job.data.jobId,
          leaseToken: job.data.leaseToken,
          attemptCount: job.data.attemptCount,
          outcome: jobOutcome,
        });
      } catch { /* a retry or lease recovery will safely reclaim the job */ }
      if (!finalised) {
        empty.needsAttention += 1;
      } else if (outcome.status === "materialised") empty.materialised += 1;
      else if (outcome.status === "unchanged") empty.unchanged += 1;
      else if (outcome.status === "awaiting_approval") empty.awaitingApproval += 1;
      else empty.needsAttention += 1;
    }
  }
  return empty;
}
