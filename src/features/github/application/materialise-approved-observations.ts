import "server-only";

import { z } from "zod";

import {
  STANDARD_GITHUB_ISO_MAPPING_PACK,
  selectGitHubObservationTreatment,
} from "../domain/mapping";
import type { GitHubObservation } from "../domain/observation";

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const safeCountSchema = z.number().int().nonnegative().max(100);

const terminalRunSchema = z.object({
  runId: uuidSchema,
  organisationId: uuidSchema,
  status: z.enum(["succeeded", "partial"]),
  observationCount: z.number().int().min(1).max(100),
}).strict();

const terminalRunReferenceSchema = terminalRunSchema.pick({
  runId: true,
  organisationId: true,
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

const observationRowSchema = z.object({
  id: uuidSchema,
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
  organisationId?: string;
  installationId?: string;
  repositoryId?: string;
  completedAfter?: string;
};

export type MaterialisationDependencies = {
  listTerminalRuns(scope: ReconciliationScope): Promise<unknown[]>;
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
  status: z.enum(["succeeded", "partial"]),
  observation_count: z.number().int().min(1).max(100),
}).strict();
const rawRunReferenceSchema = rawRunSchema.pick({ id: true, organisation_id: true }).strict();
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
  organisationId: uuidSchema.optional(),
  installationId: uuidSchema.optional(),
  repositoryId: uuidSchema.optional(),
  completedAfter: dateTimeSchema.optional(),
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
    status: run.data.status,
    observationCount: run.data.observation_count,
  };
}

export function buildMaterialisationDependencies(serviceInput: unknown): MaterialisationDependencies {
  const service = serviceInput as SupabaseServiceClient;
  return {
    async listTerminalRuns(scopeInput) {
      const scope = scopeSchema.safeParse(scopeInput);
      if (!scope.success) throw persistenceFailure();
      let query = service.from("github_collection_runs")
        .select("id,organisation_id")
        .in("status", ["succeeded", "partial"])
        .not("completed_at", "is", null);
      if (scope.data.organisationId) query = query.eq("organisation_id", scope.data.organisationId);
      if (scope.data.installationId) query = query.eq("installation_id", scope.data.installationId);
      if (scope.data.repositoryId) query = query.eq("repository_id", scope.data.repositoryId);
      if (scope.data.completedAfter) query = query.gte("completed_at", scope.data.completedAfter);
      const { data, error } = await query
        .order("completed_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(scope.data.limit);
      const rows = z.array(rawRunReferenceSchema).safeParse(data);
      if (error || !rows.success) throw persistenceFailure();
      return rows.data.map((row) => ({ runId: row.id, organisationId: row.organisation_id }));
    },
    async loadTerminalRun(target) {
      const { data, error } = await service.from("github_collection_runs")
        .select("id,organisation_id,status,observation_count")
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
        .select("id,collection_run_id,provider_repository_id,observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code")
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
  if (!parsed.success || parsed.data.length !== run.observationCount) return null;

  const observationIds = new Set<string>();
  const checkIds = new Set<string>();
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
        || observationIds.has(row.id)
        || checkIds.has(row.check_id)
      ) return null;
      observationIds.add(row.id);
      checkIds.add(row.check_id);
      const treatment = selectGitHubObservationTreatment(
        STANDARD_GITHUB_ISO_MAPPING_PACK,
        toObservation(row),
      );
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
  let values: unknown[];
  try {
    values = await deps.listTerminalRuns(scope);
  } catch {
    return { ...empty, needsAttention: 1 };
  }
  if (!Array.isArray(values) || values.length > scope.limit) return { ...empty, needsAttention: 1 };

  for (const value of values) {
    const reference = terminalRunReferenceSchema.safeParse(value);
    if (!reference.success) {
      empty.needsAttention += 1;
      continue;
    }
    empty.runsConsidered += 1;
    const outcome = await materialiseApprovedGitHubObservations(deps, {
      organisationId: reference.data.organisationId,
      collectionRunId: reference.data.runId,
    });
    if (outcome.status === "materialised") empty.materialised += 1;
    else if (outcome.status === "unchanged") empty.unchanged += 1;
    else if (outcome.status === "awaiting_approval") empty.awaitingApproval += 1;
    else empty.needsAttention += 1;
  }
  return empty;
}
