import "server-only";

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { ShadowProofInput } from "./github-shadow-proof";

const CONTAINER = "supabase_db_compliancehub";
const CONTAINER_PROOF = "/supabase_db_compliancehub|compliancehub|compliancehub";
const APPROVED_DOCKER_CONTEXT = "colima";
const APPROVED_DOCKER_ENDPOINT = "unix:///Users/m1ghty/.colima/default/docker.sock";
const LOCAL_API = "http://127.0.0.1:54321";
const MAX_COMMAND_OUTPUT = 128 * 1024;
const uuidSchema = z.string().uuid();

type Execute = (file: string, args: readonly string[]) => Promise<string>;

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.literal(LOCAL_API),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GITHUB_APP_ID: z.string().trim().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().trim().min(1),
  GITHUB_ALLOWED_ACCOUNT_ID: z.string().regex(/^[1-9]\d*$/),
  GITHUB_ALLOWED_ACCOUNT_TYPE: z.literal("User"),
  GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: z.string().regex(/^\d+(?:,\d+){0,19}$/),
}).strict();

const scopeEnvelopeSchema = z.object({
  activeInstallationCount: z.literal(1),
  repositories: z.array(z.unknown()).length(1),
}).strict();

const protectedTables = {
  materialisationJobs: ["github_materialisation_jobs"],
  officialResults: ["github_official_compliance_results"],
  githubEvidenceProvenance: ["github_evidence_provenance"],
  githubFindingProvenance: ["github_finding_provenance", "github_finding_transitions"],
  evidenceAndFindings: ["evidence", "evidence_links", "evidence_sources", "monitoring_findings"],
  readinessSoaAssessmentRisk: [
    "organisation_scope_profiles",
    "soa_registers",
    "soa_items",
    "soa_snapshots",
    "assessment_sessions",
    "assessment_responses",
    "assessment_control_mappings",
    "risks",
    "risk_treatment_plans",
    "asset_risks",
    "leadership_report_snapshots",
    "tasks",
  ],
  slackDeliveries: ["daily_digest_deliveries", "daily_digest_delivery_attempts", "notifications"],
} as const;

function denied(kind: "configuration" | "target" | "state"): Error {
  return new Error(`GitHub shadow proof local ${kind} denied`);
}

function defaultExecute(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], {
      encoding: "utf8",
      maxBuffer: MAX_COMMAND_OUTPUT,
      timeout: 15_000,
      windowsHide: true,
    }, (error, stdout) => {
      if (error || typeof stdout !== "string" || stdout.length > MAX_COMMAND_OUTPUT) reject(denied("state"));
      else resolve(stdout);
    });
  });
}

function parseJson(stdout: string): unknown {
  if (stdout.length < 1 || stdout.length > MAX_COMMAND_OUTPUT) throw denied("state");
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw denied("state");
  }
}

function psql(execute: Execute, sql: string): Promise<string> {
  return execute("docker", [
    "--host",
    APPROVED_DOCKER_ENDPOINT,
    "exec",
    CONTAINER,
    "psql",
    "--username",
    "postgres",
    "--dbname",
    "postgres",
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--command",
    sql,
  ]);
}

function scopeSql(allowedAccountId: number): string {
  return `
with allowed_installations as (
  select installation.*
  from public.github_installations installation
  where installation.account_id = ${allowedAccountId}
    and installation.account_login = 'mukta2701'
    and installation.account_type = 'User'
    and installation.status = 'active'
), selected_repositories as (
  select jsonb_build_object(
    'organisationId', installation.organisation_id,
    'installationId', installation.id,
    'repositoryId', repository.id,
    'providerInstallationId', installation.provider_installation_id,
    'providerRepositoryId', repository.provider_repository_id,
    'accountId', installation.account_id,
    'accountLogin', installation.account_login,
    'accountType', installation.account_type,
    'installationStatus', installation.status,
    'permissionsOk', installation.permissions_ok,
    'owner', repository.owner_login,
    'name', repository.name,
    'selected', repository.selected,
    'available', repository.available
  ) as payload
  from allowed_installations installation
  join public.github_repositories repository
    on repository.installation_id = installation.id
   and repository.organisation_id = installation.organisation_id
  where repository.selected = true
    and repository.available = true
)
select jsonb_build_object(
  'activeInstallationCount', (select count(*) from allowed_installations),
  'repositories', coalesce((select jsonb_agg(payload) from selected_repositories), '[]'::jsonb)
);
`.trim();
}

function protectedStateSql(organisationId: string, localDate: string): string {
  if (!uuidSchema.safeParse(organisationId).success || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw denied("state");
  const scopedTable = (group: string, table: string) => (
    `select '${group}'::text as group_name, '${table}:' || to_jsonb(row_value)::text as row_payload from public.${table} row_value where row_value.organisation_id = '${organisationId}'::uuid`
  );
  const rows = Object.entries(protectedTables).flatMap(([group, tables]) =>
    tables.map((table) => table === "assessment_control_mappings"
      ? `select '${group}'::text as group_name, '${table}:' || to_jsonb(row_value)::text as row_payload
         from public.${table} row_value
         where exists (
           select 1
           from public.catalogue_questions question
           join public.assessment_sessions session on session.catalogue_version_id = question.catalogue_version_id
           where question.id = row_value.catalogue_question_id
             and session.organisation_id = '${organisationId}'::uuid
         )`
      : scopedTable(group, table)));
  rows.push(
    scopedTable("githubMappingApprovalLineage", "github_mapping_approvals"),
    `select 'githubMappingApprovalLineage'::text as group_name, 'github_mapping_packs:' || to_jsonb(pack)::text as row_payload
     from public.github_mapping_packs pack
     where exists (select 1 from public.github_mapping_approvals approval where approval.organisation_id = '${organisationId}'::uuid and approval.mapping_pack_id = pack.id)`,
    `select 'githubMappingApprovalLineage'::text as group_name, 'github_mapping_entries:' || to_jsonb(entry)::text as row_payload
     from public.github_mapping_entries entry
     where exists (select 1 from public.github_mapping_approvals approval where approval.organisation_id = '${organisationId}'::uuid and approval.mapping_pack_id = entry.mapping_pack_id)`,
  );
  const groups = [...Object.keys(protectedTables), "githubMappingApprovalLineage", "mcpDigest"]
    .map((group) => `('${group}')`).join(",");
  return `
with owner_identity as materialized (
  select membership.user_id
  from public.memberships membership
  where membership.organisation_id = '${organisationId}'::uuid
    and membership.role = 'owner'
  order by membership.user_id
  limit 1
), caller_context as materialized (
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', owner_identity.user_id, 'role', 'authenticated')::text,
    true
  ) as configured
  from owner_identity
), mcp_bundle as materialized (
  select public.get_mcp_compliance_bundle_v2(
    '${organisationId}'::uuid,
    '${localDate}'::date,
    20,
    20,
    20
  ) #- '{github,asOf}' as value
  from caller_context
), protected_rows as (
  ${rows.join("\n  union all\n  ")}
  union all
  select 'mcpDigest'::text as group_name, 'mcp_fact_bundle:' || to_jsonb(mcp_bundle.value)::text as row_payload
  from mcp_bundle
  where mcp_bundle.value is not null
), required_groups(group_name) as (
  values ${groups}
), summaries as (
  select required.group_name,
    count(protected.row_payload)::integer as row_count,
    encode(extensions.digest(coalesce(string_agg(length(protected.row_payload)::text || ':' || protected.row_payload, E'\\n' order by protected.row_payload), ''), 'sha256'), 'hex') as state_hash
  from required_groups required
  left join protected_rows protected on protected.group_name = required.group_name
  group by required.group_name
)
select jsonb_object_agg(group_name, jsonb_build_object('count', row_count, 'sha256', state_hash))
from summaries;
`.trim();
}

function outcomeSql(runId: string): string {
  if (!uuidSchema.safeParse(runId).success) throw denied("state");
  return `
select jsonb_build_object(
  'runMode', run.run_mode,
  'status', run.status,
  'organisationId', run.organisation_id,
  'installationId', run.installation_id,
  'repositoryId', run.repository_id,
  'providerRepositoryId', run.provider_repository_id,
  'observationCount', (select count(*) from public.github_observations observation where observation.collection_run_id = run.id),
  'materialisationJobCount', (select count(*) from public.github_materialisation_jobs job where job.collection_run_id = run.id),
  'observations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'organisationId', observation.organisation_id,
      'installationId', observation.installation_id,
      'repositoryId', observation.repository_id,
      'providerRepositoryId', observation.provider_repository_id,
      'collectionRunId', observation.collection_run_id,
      'checkId', observation.check_id,
      'ruleVersion', observation.rule_version,
      'result', observation.result,
      'diagnosticCode', observation.diagnostic_code,
      'observedAt', observation.observed_at,
      'freshUntil', observation.fresh_until,
      'fingerprint', observation.fingerprint
    ) order by observation.check_id)
    from public.github_observations observation
    where observation.collection_run_id = run.id
  ), '[]'::jsonb)
)
from public.github_collection_runs run
where run.id = '${runId}'::uuid;
`.trim();
}

export function buildLocalGitHubShadowProofInput(
  environmentInput: Record<string, string | undefined>,
  dependencies: { execute?: Execute } = {},
): ShadowProofInput {
  if (environmentInput.DOCKER_HOST !== undefined || environmentInput.DOCKER_CONTEXT !== undefined) {
    throw denied("configuration");
  }
  const environment = environmentSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: environmentInput.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: environmentInput.SUPABASE_SERVICE_ROLE_KEY,
    GITHUB_APP_ID: environmentInput.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: environmentInput.GITHUB_APP_PRIVATE_KEY,
    GITHUB_ALLOWED_ACCOUNT_ID: environmentInput.GITHUB_ALLOWED_ACCOUNT_ID,
    GITHUB_ALLOWED_ACCOUNT_TYPE: environmentInput.GITHUB_ALLOWED_ACCOUNT_TYPE,
    GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: environmentInput.GITHUB_APPROVED_SECURITY_WORKFLOW_IDS,
  });
  if (!environment.success) throw denied("configuration");
  const allowedAccountId = Number(environment.data.GITHUB_ALLOWED_ACCOUNT_ID);
  const workflowIds = environment.data.GITHUB_APPROVED_SECURITY_WORKFLOW_IDS.split(",").map(Number);
  if (
    !Number.isSafeInteger(allowedAccountId)
    || allowedAccountId <= 0
    || workflowIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || new Set(workflowIds).size !== workflowIds.length
  ) throw denied("configuration");

  const execute = dependencies.execute ?? defaultExecute;
  const service = createClient(
    environment.data.NEXT_PUBLIC_SUPABASE_URL,
    environment.data.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  let targetInspection: Promise<string> | undefined;
  async function ensureLocalTarget(): Promise<string> {
    targetInspection ??= (async () => {
      const context = (await execute("docker", ["context", "show"]).catch(() => "")).trim();
      if (context !== APPROVED_DOCKER_CONTEXT) throw denied("target");
      const endpoint = (await execute("docker", [
        "context",
        "inspect",
        "--format",
        '{{(index .Endpoints "docker").Host}}',
        APPROVED_DOCKER_CONTEXT,
      ]).catch(() => "")).trim();
      if (endpoint !== APPROVED_DOCKER_ENDPOINT) throw denied("target");
      const result = await execute("docker", [
        "--host",
        APPROVED_DOCKER_ENDPOINT,
        "inspect",
        "--format",
        '{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.supabase.cli.project"}}',
        CONTAINER,
      ]).catch(() => "");
      if (result.trim() !== CONTAINER_PROOF) throw denied("target");
      return CONTAINER;
    })();
    return targetInspection;
  }
  async function checkedPsql(sql: string): Promise<string> {
    await ensureLocalTarget();
    return psql(execute, sql);
  }
  return {
    service,
    allowedAccountId,
    appId: environment.data.GITHUB_APP_ID,
    privateKey: environment.data.GITHUB_APP_PRIVATE_KEY,
    approvedSecurityWorkflowIds: workflowIds,
    fetchImpl: fetch,
    requestKey: `manual:shadow-proof:${randomUUID()}`,
    async inspectLocalTarget() {
      return ensureLocalTarget();
    },
    async loadScope() {
      const envelope = scopeEnvelopeSchema.safeParse(parseJson(await checkedPsql(scopeSql(allowedAccountId))));
      if (!envelope.success) throw denied("state");
      return envelope.data.repositories;
    },
    async captureProtectedState(context) {
      return parseJson(await checkedPsql(protectedStateSql(context.organisationId, context.localDate)));
    },
    async inspectShadowOutcome(runId) {
      return parseJson(await checkedPsql(outcomeSql(runId)));
    },
  };
}
