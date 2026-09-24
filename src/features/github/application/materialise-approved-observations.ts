import "server-only";

import { z } from "zod";

import {
  mappingPackSchema,
  STANDARD_GITHUB_ISO_MAPPING_PACK,
  selectGitHubObservationTreatment,
  type GitHubMappingPack,
} from "../domain/mapping";
import {
  processGitHubComplianceResultAlerts,
  type GitHubComplianceResultAlertRunOptions,
} from "@/features/monitoring/application/github-compliance-result-alert-workflow";
import { siteUrl } from "@/lib/site-url";
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

const effectiveMappingSchema = z.object({
  mappingPackId: uuidSchema,
  version: z.string().min(1).max(80),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: dateTimeSchema.nullable(),
  pack: mappingPackSchema,
  entries: z.array(z.object({
    checkId: z.string().min(1).max(120),
    status: z.enum(["approved", "rejected", "pending"]),
  }).strict()).length(EXPECTED_GITHUB_CHECK_IDS.length),
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
  inspectJobs(scope: { limit: number; collectionRunIds?: string[] }): Promise<unknown[]>;
  finaliseJob(job: Pick<ClaimedMaterialisationJob, "jobId" | "leaseToken" | "attemptCount"> & { outcome: MaterialisationJobOutcome }): Promise<boolean>;
  loadTerminalRun(target: { organisationId: string; collectionRunId: string }): Promise<unknown | null>;
  loadEffectiveMapping(organisationId: string): Promise<unknown | null>;
  loadObservations(target: { organisationId: string; collectionRunId: string }): Promise<unknown[]>;
  materialise(input: MaterialisationRpcInput): Promise<{ data: unknown; error: unknown }>;
  evaluateResultAlerts(options: Pick<GitHubComplianceResultAlertRunOptions, "evaluatedAt" | "scope">): Promise<{
    candidates: number;
    eventsCreated: number;
    notificationsCreated: number;
    conflicts: number;
  }>;
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
    alertEventsCreated?: number;
    notificationsCreated?: number;
  };

export type ReconciliationSummary = {
  runsConsidered: number;
  materialised: number;
  unchanged: number;
  awaitingApproval: number;
  needsAttention: number;
  alertEventsCreated?: number;
  notificationsCreated?: number;
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
const rawPackSchema = z.object({
  id: uuidSchema,
  version: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  published_at: dateTimeSchema,
}).strict();
const rawMappingEntrySchema = z.object({
  mapping_pack_id: uuidSchema,
  check_id: z.string().min(1).max(120),
  rule_version: z.string().min(1).max(80),
  iso_control_references: z.array(z.string()).min(1).max(4),
  failure_severity: z.enum(["low", "medium", "high", "critical"]),
  remediation: z.string().min(1).max(400),
  treatments: z.unknown(),
}).strict();
const rawEffectiveEntrySchema = z.object({
  mapping_pack_id: uuidSchema,
  check_id: z.string().min(1).max(120),
  status: z.enum(["approved", "rejected", "pending"]),
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
  attemptCount: z.number().int().min(0).max(25),
  collectionRunId: uuidSchema,
  organisationId: uuidSchema,
}).strict();
const rawClaimedJobSchema = z.object({
  job_id: uuidSchema,
  lease_token: uuidSchema,
  attempt_count: z.number().int().min(0).max(25),
  collection_run_id: uuidSchema,
  organisation_id: uuidSchema,
}).strict();
const inspectedJobSchema = z.object({
  collectionRunId: uuidSchema,
  status: z.enum(["pending", "awaiting_approval", "retryable", "completed", "exhausted"]),
  leaseActive: z.boolean(),
}).strict();
const rawInspectedJobSchema = z.object({
  collection_run_id: uuidSchema,
  status: z.enum(["pending", "awaiting_approval", "retryable", "completed", "exhausted"]),
  lease_active: z.boolean(),
}).strict();
const jobScopeSchema = z.object({
  limit: z.number().int().min(1).max(100),
  collectionRunIds: z.array(uuidSchema).min(1).max(100).optional(),
}).strict();

function parseJobScope(value: unknown): z.infer<typeof jobScopeSchema> {
  const parsed = jobScopeSchema.safeParse(value);
  if (!parsed.success || (parsed.data.collectionRunIds && new Set(parsed.data.collectionRunIds).size !== parsed.data.collectionRunIds.length)) {
    throw persistenceFailure();
  }
  return parsed.data;
}

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
      const parsed = parseJobScope(scope);
      const { data, error } = await service.rpc("claim_github_materialisation_jobs_server", {
        target_limit: parsed.limit,
        target_collection_run_ids: parsed.collectionRunIds ?? null,
      });
      const rows = z.array(rawClaimedJobSchema).max(parsed.limit).safeParse(data);
      if (error || !rows.success) throw persistenceFailure();
      return rows.data.map((row) => ({
        jobId: row.job_id,
        leaseToken: row.lease_token,
        attemptCount: row.attempt_count,
        collectionRunId: row.collection_run_id,
        organisationId: row.organisation_id,
      }));
    },
    async inspectJobs(scope) {
      const parsed = parseJobScope(scope);
      const { data, error } = await service.rpc("inspect_github_materialisation_jobs_server", {
        target_limit: parsed.limit,
        target_collection_run_ids: parsed.collectionRunIds ?? null,
      });
      const rows = z.array(rawInspectedJobSchema).max(parsed.limit).safeParse(data);
      if (error || !rows.success) throw persistenceFailure();
      return rows.data.map((row) => ({
        collectionRunId: row.collection_run_id,
        status: row.status,
        leaseActive: row.lease_active,
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
    async loadEffectiveMapping(organisationId) {
      const { data, error } = await service.from("github_effective_mapping_entry_decisions")
        .select("mapping_pack_id,check_id,status")
        .eq("organisation_id", organisationId)
        .order("check_id", { ascending: true })
        .limit(100);
      const entries = z.array(rawEffectiveEntrySchema).safeParse(data);
      if (error || !entries.success) throw persistenceFailure();
      if (entries.data.length === 0) return null;
      const packId = entries.data[0]!.mapping_pack_id;
      if (entries.data.length !== EXPECTED_GITHUB_CHECK_IDS.length
        || entries.data.some((entry) => entry.mapping_pack_id !== packId)
        || new Set(entries.data.map((entry) => entry.check_id)).size !== EXPECTED_GITHUB_CHECK_IDS.length
        || entries.data.some((entry) => !EXPECTED_GITHUB_CHECK_IDS.includes(entry.check_id as typeof EXPECTED_GITHUB_CHECK_IDS[number]))) {
        throw persistenceFailure();
      }
      const packResult = await service.from("github_mapping_packs")
        .select("id,version,title,checksum,published_at")
        .eq("id", packId)
        .maybeSingle();
      const pack = rawPackSchema.safeParse(packResult.data);
      if (packResult.error || !pack.success || pack.data.id !== packId) throw persistenceFailure();
      const mappingResult = await service.from("github_mapping_entries")
        .select("mapping_pack_id,check_id,rule_version,iso_control_references,failure_severity,remediation,treatments")
        .eq("mapping_pack_id", packId)
        .order("check_id", { ascending: true })
        .limit(100);
      const mappingRows = z.array(rawMappingEntrySchema).safeParse(mappingResult.data);
      if (mappingResult.error || !mappingRows.success || mappingRows.data.length !== EXPECTED_GITHUB_CHECK_IDS.length
        || mappingRows.data.some((row) => row.mapping_pack_id !== packId)) throw persistenceFailure();
      const selectedPack = mappingPackSchema.safeParse({
        version: pack.data.version,
        title: pack.data.title,
        checksum: pack.data.checksum,
        mappings: mappingRows.data.map((row) => ({
          checkId: row.check_id,
          ruleVersion: row.rule_version,
          isoControlReferences: row.iso_control_references,
          failureSeverity: row.failure_severity,
          remediation: row.remediation,
          treatments: row.treatments,
        })),
      });
      if (!selectedPack.success) throw persistenceFailure();
      return {
        mappingPackId: packId,
        version: pack.data.version,
        checksum: pack.data.checksum,
        publishedAt: pack.data.published_at,
        pack: selectedPack.data,
        entries: entries.data.map((entry) => ({ checkId: entry.check_id, status: entry.status })),
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
      const { data, error } = await service.rpc("materialise_github_approved_entries_server", input);
      return { data, error };
    },
    async evaluateResultAlerts(options) {
      const summary = await processGitHubComplianceResultAlerts({
        async loadCandidates(input) {
          const { data, error } = await service.rpc("load_github_compliance_result_alert_candidates", {
            target_evaluated_at: input.evaluatedAt,
            target_collection_run_id: input.collectionRunId ?? null,
            target_organisation_id: input.organisationId ?? null,
            target_after_organisation_id: input.after?.organisationId ?? null,
            target_after_repository_id: input.after?.repositoryId ?? null,
            target_after_check_id: input.after?.checkId ?? null,
            target_limit: input.limit,
          });
          if (error) throw persistenceFailure();
          return data;
        },
        async saveDecisions(decisions, evaluatedAt) {
          const { data, error } = await service.rpc("record_github_compliance_result_alert_decisions", {
            target_decisions: decisions,
            target_evaluated_at: evaluatedAt,
          });
          if (error) throw persistenceFailure();
          return data;
        },
      }, {
        ...options,
        appOrigin: siteUrl(),
        allowLocalHttp: process.env.NODE_ENV !== "production",
      });
      if (summary.conflicts > 0) throw persistenceFailure();
      return summary;
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

function mapDecisions(
  rows: unknown[],
  run: z.infer<typeof terminalRunSchema>,
  approvedCheckIds: ReadonlySet<string>,
  selectedPack: GitHubMappingPack,
): MaterialisationDecision[] | null {
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
      const observedRuleTreatment = selectGitHubObservationTreatment(
        STANDARD_GITHUB_ISO_MAPPING_PACK,
        toObservation(row),
      );
      if (
        row.result === "fail"
        && (row.severity !== observedRuleTreatment.failureSeverity || row.remediation !== observedRuleTreatment.remediation)
      ) return null;
      if (approvedCheckIds.has(row.check_id)) {
        const treatment = selectGitHubObservationTreatment(selectedPack, toObservation(row));
        decisions.push({
          observation_id: row.id,
          treatment_kind: treatment.kind,
          iso_control_references: [...treatment.isoControlReferences],
          failure_severity: treatment.failureSeverity,
          remediation: treatment.remediation,
        });
      }
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

  let mappingValue: unknown | null;
  try {
    mappingValue = await deps.loadEffectiveMapping(target.organisationId);
  } catch {
    return { status: "retryable_failure", collectionRunId: target.collectionRunId };
  }
  if (mappingValue === null) return { status: "awaiting_approval", collectionRunId: target.collectionRunId };
  const parsedMapping = effectiveMappingSchema.safeParse(mappingValue);
  if (!parsedMapping.success
    || new Set(parsedMapping.data.entries.map((entry) => entry.checkId)).size !== EXPECTED_GITHUB_CHECK_IDS.length
    || parsedMapping.data.entries.some((entry) => !EXPECTED_GITHUB_CHECK_IDS.includes(entry.checkId as typeof EXPECTED_GITHUB_CHECK_IDS[number]))) {
    return { status: "invalid_data", collectionRunId: target.collectionRunId };
  }
  if (
    parsedMapping.data.publishedAt === null
    || parsedMapping.data.version !== parsedMapping.data.pack.version
    || parsedMapping.data.checksum !== parsedMapping.data.pack.checksum
  ) return { status: "stale_approval", collectionRunId: target.collectionRunId };

  let rows: unknown[];
  try {
    rows = await deps.loadObservations(target);
  } catch {
    return { status: "retryable_failure", collectionRunId: target.collectionRunId };
  }
  const approvedCheckIds = new Set(parsedMapping.data.entries
    .filter((entry) => entry.status === "approved")
    .map((entry) => entry.checkId));
  const decisions = mapDecisions(rows, parsedRun.data, approvedCheckIds, parsedMapping.data.pack);
  if (!decisions) return { status: "invalid_data", collectionRunId: target.collectionRunId };
  if (decisions.length === 0 && parsedMapping.data.entries.some((entry) => entry.status === "pending")) {
    return { status: "awaiting_approval", collectionRunId: target.collectionRunId };
  }

  let rpcResult: { data: unknown; error: unknown };
  try {
    rpcResult = await deps.materialise({
      target_organisation_id: target.organisationId,
      target_collection_run_id: target.collectionRunId,
      target_mapping_version: parsedMapping.data.version,
      target_mapping_checksum: parsedMapping.data.checksum,
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
  let alertSummary: Awaited<ReturnType<MaterialisationDependencies["evaluateResultAlerts"]>>;
  try {
    alertSummary = await deps.evaluateResultAlerts({
      evaluatedAt: new Date().toISOString(),
      scope: { collectionRunId: target.collectionRunId, organisationId: target.organisationId },
    });
  } catch {
    return { status: "retryable_failure", collectionRunId: target.collectionRunId };
  }
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
    ...(alertSummary.eventsCreated > 0 ? { alertEventsCreated: alertSummary.eventsCreated } : {}),
    ...(alertSummary.notificationsCreated > 0 ? { notificationsCreated: alertSummary.notificationsCreated } : {}),
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
    let values: unknown[] = [];
    try {
      values = await deps.claimJobs(claimScope);
    } catch {
      empty.needsAttention += 1;
    }
    if (!Array.isArray(values) || values.length > claimScope.limit) {
      empty.needsAttention += 1;
      values = [];
    }
    const claimedRunIds = new Set<string>();
    for (const value of values) {
      const job = claimedJobSchema.safeParse(value);
      if (!job.success) {
        empty.needsAttention += 1;
        continue;
      }
      claimedRunIds.add(job.data.collectionRunId);
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
      } else if (outcome.status === "materialised") {
        empty.materialised += 1;
        if (outcome.alertEventsCreated) empty.alertEventsCreated = (empty.alertEventsCreated ?? 0) + outcome.alertEventsCreated;
        if (outcome.notificationsCreated) empty.notificationsCreated = (empty.notificationsCreated ?? 0) + outcome.notificationsCreated;
      } else if (outcome.status === "unchanged") {
        empty.unchanged += 1;
        if (outcome.alertEventsCreated) empty.alertEventsCreated = (empty.alertEventsCreated ?? 0) + outcome.alertEventsCreated;
        if (outcome.notificationsCreated) empty.notificationsCreated = (empty.notificationsCreated ?? 0) + outcome.notificationsCreated;
      }
      else if (outcome.status === "awaiting_approval") empty.awaitingApproval += 1;
      else empty.needsAttention += 1;
    }

    const exactRunIds = "collectionRunIds" in claimScope ? claimScope.collectionRunIds : undefined;
    const unclaimedRunIds = exactRunIds?.filter((collectionRunId) => !claimedRunIds.has(collectionRunId));
    const inspectionScope = unclaimedRunIds
      ? unclaimedRunIds.length > 0 ? { limit: unclaimedRunIds.length, collectionRunIds: unclaimedRunIds } : null
      : { limit: claimScope.limit };
    if (inspectionScope) {
      try {
        const inspectionValues = await deps.inspectJobs(inspectionScope);
        const inspections = z.array(inspectedJobSchema).max(inspectionScope.limit).safeParse(inspectionValues);
        if (!inspections.success) {
          empty.needsAttention += 1;
          continue;
        }
        const inspectedRunIds = new Set<string>();
        for (const inspection of inspections.data) {
          if (
            inspectedRunIds.has(inspection.collectionRunId)
            || (unclaimedRunIds && !unclaimedRunIds.includes(inspection.collectionRunId))
          ) {
            empty.needsAttention += 1;
            continue;
          }
          inspectedRunIds.add(inspection.collectionRunId);
          empty.runsConsidered += 1;
          if (inspection.status !== "completed") empty.needsAttention += 1;
        }
        if (unclaimedRunIds) {
          const missingCount = unclaimedRunIds.filter((collectionRunId) => !inspectedRunIds.has(collectionRunId)).length;
          empty.runsConsidered += missingCount;
          empty.needsAttention += missingCount;
        }
      } catch {
        empty.needsAttention += 1;
        if (unclaimedRunIds) empty.runsConsidered += unclaimedRunIds.length;
      }
    }
  }
  try {
    const alertSummary = await deps.evaluateResultAlerts({
      evaluatedAt: new Date().toISOString(),
      scope: { due: true },
    });
    if (alertSummary.eventsCreated > 0) empty.alertEventsCreated = (empty.alertEventsCreated ?? 0) + alertSummary.eventsCreated;
    if (alertSummary.notificationsCreated > 0) empty.notificationsCreated = (empty.notificationsCreated ?? 0) + alertSummary.notificationsCreated;
  } catch {
    empty.needsAttention += 1;
  }
  return empty;
}
