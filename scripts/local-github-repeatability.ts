import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { buildCollectionDependencies } from "../src/features/github/application/collection-deps";
import { buildMaterialisationDependencies, reconcileApprovedGitHubObservations } from "../src/features/github/application/materialise-approved-observations";
import { runGitHubCollection } from "../src/features/github/application/run-collection";

const failure = () => new Error("Local GitHub repeatability preflight failed");
const uuidSchema = z.string().uuid();
const safeIdSchema = z.number().int().positive().safe();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const localDatabaseContainer = "supabase_db_compliancehub";

type RuntimeConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  allowedAccountId: number;
  appId: string;
  privateKey: string;
  approvedWorkflowIds: number[];
};

type RuntimeEnvironment = Record<string, string | undefined>;

type Installation = {
  id: string;
  organisation_id: string;
  account_id: number;
  account_type: "User";
  status: "active";
  permissions_ok: true;
};

const installationSchema = z.object({
  id: uuidSchema,
  organisation_id: uuidSchema,
  account_id: safeIdSchema,
  account_type: z.literal("User"),
  status: z.literal("active"),
  permissions_ok: z.literal(true),
}).strict();

const repositorySchema = z.object({
  id: uuidSchema,
  organisation_id: uuidSchema,
  installation_id: uuidSchema,
  provider_repository_id: safeIdSchema,
  selected: z.literal(true),
  available: z.literal(true),
}).strict();

const approvalSchema = z.object({
  id: uuidSchema,
  organisation_id: uuidSchema,
  mapping_pack_id: uuidSchema,
  github_mapping_packs: z.object({
    id: uuidSchema,
    version: z.string().min(1).max(128),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
    published_at: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

function nonempty(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw failure();
  return trimmed;
}

function exactLocalSupabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw failure();
  }
  if (
    parsed.protocol !== "http:"
    || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    || parsed.port !== "54321"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) throw failure();
  return parsed.toString();
}

export function parseApprovedWorkflowIds(value: string | undefined): number[] {
  const values = value?.split(",") ?? [];
  if (values.length < 1 || values.length > 20 || values.some((id) => !/^[1-9][0-9]*$/.test(id))) throw failure();
  const parsed = values.map(Number);
  if (parsed.some((id) => !Number.isSafeInteger(id)) || new Set(parsed).size !== parsed.length) throw failure();
  return parsed;
}

export function requireLocalRuntimeConfig(env: RuntimeEnvironment): RuntimeConfig {
  const accountId = Number(nonempty(env.GITHUB_ALLOWED_ACCOUNT_ID));
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || env.GITHUB_ALLOWED_ACCOUNT_TYPE !== "User") throw failure();
  return {
    supabaseUrl: exactLocalSupabaseUrl(nonempty(env.NEXT_PUBLIC_SUPABASE_URL)),
    serviceRoleKey: nonempty(env.SUPABASE_SERVICE_ROLE_KEY),
    allowedAccountId: accountId,
    appId: nonempty(env.GITHUB_APP_ID),
    privateKey: nonempty(env.GITHUB_APP_PRIVATE_KEY),
    approvedWorkflowIds: parseApprovedWorkflowIds(env.GITHUB_APPROVED_SECURITY_WORKFLOW_IDS),
  };
}

export function selectExactlyOneInstallation(rows: unknown, allowedAccountId: number): Installation {
  const parsed = z.array(installationSchema).safeParse(rows);
  if (!parsed.success || parsed.data.length !== 1 || parsed.data[0].account_id !== allowedAccountId) throw failure();
  return parsed.data[0];
}

export function selectExactlyOneSelectedRepository(
  rows: unknown,
  installation: Pick<Installation, "id" | "organisation_id">,
) {
  const parsed = z.array(repositorySchema).safeParse(rows);
  if (!parsed.success || parsed.data.length !== 1) throw failure();
  const [repository] = parsed.data;
  if (repository.organisation_id !== installation.organisation_id || repository.installation_id !== installation.id) throw failure();
  return repository;
}

export function selectExactlyOneActivePublishedApproval(rows: unknown, organisationId: string) {
  const organisation = uuidSchema.safeParse(organisationId);
  const parsed = z.array(approvalSchema).safeParse(rows);
  if (
    !organisation.success
    || !parsed.success
    || parsed.data.length !== 1
    || parsed.data[0].organisation_id !== organisation.data
    || parsed.data[0].mapping_pack_id !== parsed.data[0].github_mapping_packs.id
  ) throw failure();
  return parsed.data[0];
}

// The psql variable is constrained to UUID input before execution. This query returns
// one canonical JSON value only; the caller hashes it and never logs record contents.
export const localProtectedStateSql = `
\\pset footer off
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'risk_matrix_config', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.risk_matrix_config row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'risks', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.risks row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'tasks', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.tasks row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'non_github_evidence', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.evidence row WHERE row.organisation_id = :'org'::uuid AND NOT EXISTS (SELECT 1 FROM public.github_evidence_provenance provenance WHERE provenance.evidence_id = row.id)), '[]'::jsonb),
  'non_github_evidence_links', COALESCE((SELECT jsonb_agg(to_jsonb(link) ORDER BY link.id) FROM public.evidence_links link WHERE link.organisation_id = :'org'::uuid AND NOT EXISTS (SELECT 1 FROM public.github_evidence_provenance provenance WHERE provenance.evidence_id = link.evidence_id)), '[]'::jsonb),
  'non_github_monitoring_findings', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.monitoring_findings row WHERE row.organisation_id = :'org'::uuid AND row.finding_origin <> 'github'), '[]'::jsonb),
  'soa_registers', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.soa_registers row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'soa_items', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.soa_items row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'soa_snapshots', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.soa_snapshots row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'assessment_sessions', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.assessment_sessions row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'assessment_responses', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.assessment_responses row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'alert_channels', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.alert_channels row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'daily_digest_deliveries', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.daily_digest_deliveries row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb),
  'daily_digest_delivery_attempts', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.daily_digest_delivery_attempts row WHERE row.organisation_id = :'org'::uuid), '[]'::jsonb)
) AS protected_state;
COMMIT;
`;

const officialResultsSchema = z.object({
  count: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
  wrongInstallation: z.number().int().nonnegative(),
  unlinkedRun: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  inactiveApproval: z.number().int().nonnegative(),
}).strict();

const terminalRunSchema = z.object({
  collectionRunId: uuidSchema,
  organisationId: uuidSchema,
  installationId: uuidSchema,
  repositoryId: uuidSchema,
  providerRepositoryId: safeIdSchema,
  status: z.enum(["succeeded", "partial"]),
}).strict();

const collectionSummarySchema = z.object({
  installationsChecked: z.number().int().nonnegative(),
  repositoriesChecked: z.number().int().nonnegative(),
  observationsStored: z.number().int().nonnegative(),
  repositoriesFailed: z.number().int().nonnegative(),
  repositoriesDeferred: z.number().int().nonnegative(),
  runsPartial: z.number().int().nonnegative(),
  terminalRuns: z.array(terminalRunSchema),
}).strict();

const reconciliationSummarySchema = z.object({
  runsConsidered: z.number().int().nonnegative(),
  materialised: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  awaitingApproval: z.number().int().nonnegative(),
  needsAttention: z.number().int().nonnegative(),
}).strict();

export function assertExpectedCollection(
  value: unknown,
  repository: Pick<z.infer<typeof repositorySchema>, "id" | "organisation_id" | "installation_id" | "provider_repository_id">,
) {
  const parsed = collectionSummarySchema.safeParse(value);
  if (
    !parsed.success
    || parsed.data.installationsChecked !== 1
    || parsed.data.repositoriesChecked !== 1
    || parsed.data.observationsStored !== 15
    || parsed.data.repositoriesFailed !== 0
    || parsed.data.repositoriesDeferred !== 0
    || parsed.data.terminalRuns.length !== 1
  ) throw failure();
  const [run] = parsed.data.terminalRuns;
  if (
    run.organisationId !== repository.organisation_id
    || run.installationId !== repository.installation_id
    || run.repositoryId !== repository.id
    || run.providerRepositoryId !== repository.provider_repository_id
    || parsed.data.runsPartial !== (run.status === "partial" ? 1 : 0)
  ) throw failure();
  return value;
}

export function assertExpectedReconciliation(value: unknown): void {
  const parsed = reconciliationSummarySchema.safeParse(value);
  if (
    !parsed.success
    || parsed.data.runsConsidered !== 1
    || parsed.data.materialised + parsed.data.unchanged !== 1
    || parsed.data.awaitingApproval !== 0
    || parsed.data.needsAttention !== 0
  ) throw failure();
}

export function terminalRunLineageHash(runs: unknown): string {
  const parsed = z.array(terminalRunSchema).min(1).max(100).safeParse(runs);
  if (!parsed.success || new Set(parsed.data.map((run) => run.collectionRunId)).size !== parsed.data.length) throw failure();
  const canonical = parsed.data.map((run) => [
    run.collectionRunId,
    run.organisationId,
    run.installationId,
    run.repositoryId,
    run.providerRepositoryId,
    run.status,
  ].join(":"))
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function mappingApprovalLineageHash(value: unknown): string {
  const approval = approvalSchema.parse(value);
  const canonical = [
    approval.id,
    approval.organisation_id,
    approval.mapping_pack_id,
    approval.github_mapping_packs.id,
    approval.github_mapping_packs.version,
    approval.github_mapping_packs.checksum,
    approval.github_mapping_packs.published_at,
  ].join(":");
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildProtectedStateProof(beforeSha256: string, afterSha256: string) {
  const before = sha256Schema.parse(beforeSha256);
  const after = sha256Schema.parse(afterSha256);
  if (before !== after) throw failure();
  return { beforeSha256: before, afterSha256: after, equal: true as const };
}

export function harnessSourceHashes() {
  return {
    scriptSha256: createHash("sha256").update(readFileSync(join(process.cwd(), "scripts/local-github-repeatability.ts"))).digest("hex"),
    testSha256: createHash("sha256").update(readFileSync(join(process.cwd(), "src/test/local-github-repeatability.test.ts"))).digest("hex"),
  };
}

export function assertExpectedOfficialResults(value: unknown) {
  const parsed = officialResultsSchema.safeParse(value);
  if (
    !parsed.success
    || parsed.data.count !== 15
    || parsed.data.pass !== 8
    || parsed.data.fail !== 5
    || parsed.data.unknown !== 2
    || parsed.data.notApplicable !== 0
    || parsed.data.wrongInstallation !== 0
    || parsed.data.unlinkedRun !== 0
    || parsed.data.stale !== 0
    || parsed.data.inactiveApproval !== 0
  ) throw failure();
  return {
    count: parsed.data.count,
    pass: parsed.data.pass,
    fail: parsed.data.fail,
    unknown: parsed.data.unknown,
    notApplicable: parsed.data.notApplicable,
  };
}

const localOfficialResultsSql = `
\\pset footer off
BEGIN TRANSACTION READ ONLY;
WITH latest AS (
  SELECT DISTINCT ON (result.repository_id, result.check_id) result.*
  FROM public.github_official_compliance_results result
  WHERE result.organisation_id = :'org'::uuid
    AND result.repository_id = :'repository'::uuid
  ORDER BY result.repository_id, result.check_id, result.observed_at DESC, result.materialised_at DESC, result.id DESC
)
SELECT jsonb_build_object(
  'count', COUNT(*),
  'pass', COUNT(*) FILTER (WHERE result.outcome = 'pass'),
  'fail', COUNT(*) FILTER (WHERE result.outcome = 'fail'),
  'unknown', COUNT(*) FILTER (WHERE result.outcome = 'unknown'),
  'notApplicable', COUNT(*) FILTER (WHERE result.outcome = 'not_applicable'),
  'wrongInstallation', COUNT(*) FILTER (WHERE result.installation_id <> :'installation'::uuid),
  'unlinkedRun', COUNT(*) FILTER (WHERE result.collection_run_id <> ALL(string_to_array(:'runs', ',')::uuid[])),
  'stale', COUNT(*) FILTER (WHERE result.fresh_until <= transaction_timestamp()),
  'inactiveApproval', COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM public.github_mapping_approvals approval
    JOIN public.github_mapping_packs pack ON pack.id = approval.mapping_pack_id
    WHERE approval.id = result.approval_id
      AND approval.organisation_id = result.organisation_id
      AND approval.revoked_at IS NULL
      AND pack.id = result.mapping_pack_id
      AND pack.published_at IS NOT NULL
  ))
) AS official_results
FROM latest result;
COMMIT;
`;

export function assertApprovedLocalContainerIdentity(value: string): void {
  if (value.trim() !== "true compliancehub") throw failure();
}

export function localContainerInspectArgs(): string[] {
  return [
    "inspect",
    "--format",
    "{{.State.Running}} {{index .Config.Labels \"com.supabase.cli.project\"}}",
    localDatabaseContainer,
  ];
}

function assertLocalContainerIdentity(): void {
  let identity: string;
  try {
    identity = execFileSync("docker", localContainerInspectArgs(), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw failure();
  }
  assertApprovedLocalContainerIdentity(identity);
}

export function parseReadOnlyJsonOutput(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const withoutTrailingNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = withoutTrailingNewline.split("\n");
  if (normalized.includes("\r") || lines.length !== 3 || lines[0] !== "BEGIN" || lines[2] !== "COMMIT" || lines.some((line) => line === "")) {
    throw failure();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[1]);
  } catch {
    throw failure();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw failure();
  return lines[1];
}

function localReadOnlyQuery(args: string[], sql: string): string {
  assertLocalContainerIdentity();
  try {
    const output = execFileSync("docker", [
      "exec", "-i", "--user", "postgres", localDatabaseContainer,
      "psql", "--dbname", "postgres", "--no-psqlrc", "--tuples-only", "--no-align",
      "--set", "ON_ERROR_STOP=1", ...args,
    ], { encoding: "utf8", input: sql, stdio: ["pipe", "pipe", "pipe"] });
    return parseReadOnlyJsonOutput(output);
  } catch {
    throw failure();
  }
}

function protectedState(organisationId: string): string {
  const id = uuidSchema.safeParse(organisationId);
  if (!id.success) throw failure();
  const canonical = localReadOnlyQuery(["--set", `org=${id.data}`], localProtectedStateSql);
  if (!canonical.startsWith("{")) throw failure();
  return createHash("sha256").update(canonical).digest("hex");
}

function officialResults(organisationId: string, installationId: string, repositoryId: string, collectionRunIds: string[]) {
  const organisation = uuidSchema.safeParse(organisationId);
  const installation = uuidSchema.safeParse(installationId);
  const repository = uuidSchema.safeParse(repositoryId);
  const runs = z.array(uuidSchema).min(1).max(100).safeParse(collectionRunIds);
  if (!organisation.success || !installation.success || !repository.success || !runs.success || new Set(runs.data).size !== runs.data.length) throw failure();
  const output = localReadOnlyQuery([
    "--set", `org=${organisation.data}`,
    "--set", `installation=${installation.data}`,
    "--set", `repository=${repository.data}`,
    "--set", `runs=${runs.data.join(",")}`,
  ], localOfficialResultsSql);
  try {
    return assertExpectedOfficialResults(JSON.parse(output));
  } catch {
    throw failure();
  }
}

function writePrivateProof(summary: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), "compliancehub-github-proof-"));
  const proofPath = join(directory, "summary.json");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(proofPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(summary)}\n`, { encoding: "utf8" });
  } catch {
    throw failure();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return proofPath;
}

export type ControlledRepeatabilityResult = {
  proofPath: string;
  summary: {
    repositoriesSelected: number;
    collection: {
      installationsChecked: number;
      repositoriesChecked: number;
      observationsStored: number;
      repositoriesFailed: number;
      repositoriesDeferred: number;
      runsPartial: number;
      terminalRunStatuses: Record<string, number>;
    };
    materialisation: {
      runsConsidered: number;
      materialised: number;
      unchanged: number;
      awaitingApproval: number;
      needsAttention: number;
    };
    officialResults: { count: number; pass: number; fail: number; unknown: number; notApplicable: number };
    lineage: { terminalRunSha256: string; mappingApprovalSha256: string };
    protectedState: { beforeSha256: string; afterSha256: string; equal: true };
    harnessSource: { scriptSha256: string; testSha256: string };
    protectedSoaRiskAssessmentUnchanged: true;
  };
};

export async function runControlledRepeatability(env: RuntimeEnvironment = process.env): Promise<ControlledRepeatabilityResult> {
  const config = requireLocalRuntimeConfig(env);
  const service = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: installationRows, error: installationError } = await service
    .from("github_installations")
    .select("id,organisation_id,account_id,account_type,status,permissions_ok")
    .eq("account_id", config.allowedAccountId)
    .eq("account_type", "User")
    .eq("status", "active")
    .eq("permissions_ok", true)
    .limit(2);
  if (installationError) throw failure();
  const installation = selectExactlyOneInstallation(installationRows, config.allowedAccountId);

  const { data: repositoryRows, error: repositoryError } = await service
    .from("github_repositories")
    .select("id,organisation_id,installation_id,provider_repository_id,selected,available")
    .eq("organisation_id", installation.organisation_id)
    .eq("installation_id", installation.id)
    .eq("selected", true)
    .eq("available", true)
    .order("id", { ascending: true })
    .limit(101);
  if (repositoryError) throw failure();
  const repository = selectExactlyOneSelectedRepository(repositoryRows, installation);
  const { data: approvalRows, error: approvalError } = await service
    .from("github_mapping_approvals")
    .select("id,organisation_id,mapping_pack_id,github_mapping_packs!inner(id,version,checksum,published_at)")
    .eq("organisation_id", installation.organisation_id)
    .is("revoked_at", null)
    .not("github_mapping_packs.published_at", "is", null)
    .limit(2);
  if (approvalError) throw failure();
  const approval = selectExactlyOneActivePublishedApproval(approvalRows, installation.organisation_id);
  const before = protectedState(installation.organisation_id);

  const collection = await runGitHubCollection(buildCollectionDependencies(service, {
    appId: config.appId,
    privateKey: config.privateKey,
    approvedSecurityWorkflowIds: config.approvedWorkflowIds,
  }), {
    trigger: "manual",
    installationId: installation.id,
    requestKey: `manual:${randomUUID()}`,
  });
  assertExpectedCollection(collection, repository);
  const lineage = {
    terminalRunSha256: terminalRunLineageHash(collection.terminalRuns),
    mappingApprovalSha256: mappingApprovalLineageHash(approval),
  };

  const materialisation = await reconcileApprovedGitHubObservations(
    buildMaterialisationDependencies(service),
    { limit: 100, terminalRuns: collection.terminalRuns },
  );
  assertExpectedReconciliation(materialisation);
  const official = officialResults(
    installation.organisation_id,
    installation.id,
    repository.id,
    collection.terminalRuns.map((run) => run.collectionRunId),
  );
  const after = protectedState(installation.organisation_id);
  const protectedStateProof = buildProtectedStateProof(before, after);

  const terminalRunStatuses = collection.terminalRuns.reduce<Record<string, number>>((totals, run) => {
    totals[run.status] = (totals[run.status] ?? 0) + 1;
    return totals;
  }, {});
  const summary = {
    repositoriesSelected: 1,
    collection: {
      installationsChecked: collection.installationsChecked,
      repositoriesChecked: collection.repositoriesChecked,
      observationsStored: collection.observationsStored,
      repositoriesFailed: collection.repositoriesFailed,
      repositoriesDeferred: collection.repositoriesDeferred,
      runsPartial: collection.runsPartial,
      terminalRunStatuses,
    },
    materialisation,
    officialResults: official,
    lineage,
    protectedState: protectedStateProof,
    harnessSource: harnessSourceHashes(),
    protectedSoaRiskAssessmentUnchanged: true as const,
  };
  return { proofPath: writePrivateProof(summary), summary };
}
