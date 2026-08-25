import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { parseSafeGitHubRepositorySource } from "./github-compliance-control-room";
import { safeSummary } from "@/features/mcp/domain/safe-summary";
import type { ActiveMonitoringFindingStatus } from "@/features/monitoring/domain/finding-status";

const MAX_RECORDS = 200;
const MAPPING_QUERY_CHUNK = 20;
const LOAD_ERROR = "Could not load official GitHub record provenance";
const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
const checksum = z.string().regex(/^[0-9a-f]{64}$/);
const identifier = z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/);
const version = z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/);
const activeStatus = z.enum(["open", "acknowledged", "in_progress", "exception_requested", "risk_accepted"]);

const evidenceProvenanceRow = z.object({
  evidence_id: uuid,
  organisation_id: uuid,
  repository_id: uuid,
  observation_id: uuid,
  mapping_pack_id: uuid,
  check_id: identifier,
  rule_version: version,
  mapping_version: version,
  observed_at: dateTime,
  fresh_until: dateTime,
  created_at: dateTime,
}).strict();

const officialEvidenceLedgerRow = z.object({
  organisation_id: uuid,
  evidence_id: uuid,
}).strict();

const findingProvenanceRow = z.object({
  finding_id: uuid,
  organisation_id: uuid,
  latest_repository_id: uuid,
  latest_observation_id: uuid,
  latest_mapping_pack_id: uuid,
  check_id: identifier,
  mapping_version: version,
  first_detected_at: dateTime,
  most_recent_detected_at: dateTime,
  resolved_at: dateTime.nullable(),
}).strict();

const officialResultRow = z.object({
  organisation_id: uuid,
  observation_id: uuid,
  repository_id: uuid,
  mapping_pack_id: uuid,
  mapping_version: version,
  mapping_checksum: checksum,
  check_id: identifier,
  rule_version: version,
  outcome: z.enum(["pass", "fail", "unknown", "not_applicable"]),
  failure_severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
  catalogue_summary: z.string().min(1).max(280),
  observed_at: dateTime,
  fresh_until: dateTime,
  materialised_at: dateTime,
  evidence_id: uuid.nullable(),
  finding_id: uuid.nullable(),
}).strict();

const repositoryRow = z.object({
  id: uuid,
  organisation_id: uuid,
  full_name: z.string().min(3).max(201),
  html_url: z.string().min(1).max(500),
}).strict();

const mappingRow = z.object({
  mapping_pack_id: uuid,
  check_id: identifier,
  rule_version: version,
  iso_control_references: z.array(z.string().regex(/^A\.(?:5|6|7|8)\.\d{1,2}$/)).min(1).max(4),
}).strict();

export const GITHUB_FINDING_TRANSITION_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "exception_requested",
  "risk_accepted",
] as const;

export type GitHubFindingTransitionStatus = typeof GITHUB_FINDING_TRANSITION_STATUSES[number];

export type OfficialGitHubRecordProvenance = {
  repository: { id: string; name: string; url: string };
  checkId: string;
  catalogueSummary: string;
  observedAt: string;
  freshUntil: string;
  materialisedAt: string;
  freshness: "current" | "stale";
  ruleVersion: string;
  mappingVersion: string;
  mappingChecksum: string;
  isoControlReferences: string[];
};

export type OfficialGitHubEvidenceProvenance = OfficialGitHubRecordProvenance & {
  evidenceId: string;
};

export type OfficialGitHubFindingProvenance = OfficialGitHubRecordProvenance & {
  findingId: string;
  severity: "low" | "medium" | "high" | "critical";
  firstDetectedAt: string;
  mostRecentDetectedAt: string;
  allowedTransitions: GitHubFindingTransitionStatus[];
};

type FindingTarget = { findingId: string; status: ActiveMonitoringFindingStatus };

export function parseOfficialRecordSelection(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const parsed = uuid.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function fail(): never {
  throw new Error(LOAD_ERROR);
}

function parseIdList(values: string[]): string[] {
  const parsed = z.array(uuid).max(MAX_RECORDS).safeParse(values);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) fail();
  return parsed.data;
}

function parseAsOf(value: string): string {
  const parsed = dateTime.safeParse(value);
  if (!parsed.success) fail();
  return parsed.data;
}

function uniqueBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const mapped = new Map<string, T>();
  for (const row of rows) {
    const value = key(row);
    if (mapped.has(value)) fail();
    mapped.set(value, row);
  }
  return mapped;
}

function mappingKey(row: { mapping_pack_id: string; check_id: string; rule_version: string }): string {
  return `${row.mapping_pack_id}:${row.check_id}:${row.rule_version}`;
}

function mappingPairKey(row: { mapping_pack_id: string; check_id: string }): string {
  return `${row.mapping_pack_id}:${row.check_id}`;
}

function distinctMappingRequests(rows: Array<{ mapping_pack_id: string; check_id: string; rule_version: string }>) {
  const requests = new Map<string, { mapping_pack_id: string; check_id: string; rule_version: string }>();
  for (const row of rows) {
    const key = mappingKey(row);
    if (!requests.has(key)) {
      requests.set(key, {
        mapping_pack_id: row.mapping_pack_id,
        check_id: row.check_id,
        rule_version: row.rule_version,
      });
    }
  }
  return requests;
}

async function loadSupportingRows(
  supabase: SupabaseClient,
  organisationId: string,
  observationIds: string[],
) {
  if (observationIds.length === 0) return { results: new Map(), repositories: new Map(), mappings: new Map() };

  const resultQuery = await supabase.from("github_official_compliance_results")
    .select("organisation_id,observation_id,repository_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,failure_severity,catalogue_summary,observed_at,fresh_until,materialised_at,evidence_id,finding_id")
    .eq("organisation_id", organisationId)
    .in("observation_id", observationIds)
    .limit(MAX_RECORDS);
  const parsedResults = z.array(officialResultRow).max(MAX_RECORDS).safeParse(resultQuery.data);
  if (resultQuery.error || !parsedResults.success || parsedResults.data.length !== observationIds.length) fail();

  for (const result of parsedResults.data) {
    if (result.organisation_id !== organisationId
      || safeSummary(result.catalogue_summary, 280, "GitHub compliance result") !== result.catalogue_summary
      || Date.parse(result.fresh_until) <= Date.parse(result.observed_at)
      || Date.parse(result.materialised_at) < Date.parse(result.observed_at)) fail();
  }

  const repositoryIds = [...new Set(parsedResults.data.map((row) => row.repository_id))];
  const requiredMappings = distinctMappingRequests(parsedResults.data);
  const mappingRows = [...requiredMappings.values()];
  const mappingChunks = Array.from(
    { length: Math.ceil(mappingRows.length / MAPPING_QUERY_CHUNK) },
    (_, index) => mappingRows.slice(index * MAPPING_QUERY_CHUNK, (index + 1) * MAPPING_QUERY_CHUNK),
  );
  const [repositoryResult, mappingResults] = await Promise.all([
    supabase.from("github_repositories")
      .select("id,organisation_id,full_name,html_url")
      .eq("organisation_id", organisationId)
      .in("id", repositoryIds)
      .limit(MAX_RECORDS),
    Promise.all(mappingChunks.map((chunk) => supabase.from("github_mapping_entries")
      .select("mapping_pack_id,check_id,rule_version,iso_control_references")
      .or([...new Map(chunk.map((row) => [mappingPairKey(row), row])).values()]
        .map((row) => `and(mapping_pack_id.eq.${row.mapping_pack_id},check_id.eq.${row.check_id})`).join(","))
      .order("mapping_pack_id", { ascending: true })
      .order("check_id", { ascending: true })
      .limit(MAX_RECORDS))),
  ]);
  const parsedRepositories = z.array(repositoryRow).max(MAX_RECORDS).safeParse(repositoryResult.data);
  if (repositoryResult.error || !parsedRepositories.success || mappingResults.some((result) => result.error)) fail();
  const parsedMappings = z.array(mappingRow).max(MAX_RECORDS).safeParse(mappingResults.flatMap((result) => result.data ?? []));
  if (!parsedMappings.success) fail();

  const repositories = uniqueBy(parsedRepositories.data, (row) => row.id);
  for (const repository of repositories.values()) {
    if (repository.organisation_id !== organisationId) fail();
    try {
      parseSafeGitHubRepositorySource({ name: repository.full_name, url: repository.html_url });
    } catch {
      fail();
    }
  }

  if (parsedMappings.data.length !== requiredMappings.size) fail();
  const mappings = new Map<string, z.infer<typeof mappingRow>>();
  for (const mapping of parsedMappings.data) {
    const key = mappingKey(mapping);
    if (!requiredMappings.has(key) || mappings.has(key)) fail();
    mappings.set(key, mapping);
  }
  if (mappings.size !== requiredMappings.size) fail();

  return {
    results: uniqueBy(parsedResults.data, (row) => row.observation_id),
    repositories,
    mappings,
  };
}

function commonRecord(
  organisationId: string,
  asOf: string,
  result: z.infer<typeof officialResultRow>,
  supporting: Awaited<ReturnType<typeof loadSupportingRows>>,
): OfficialGitHubRecordProvenance {
  const repository = supporting.repositories.get(result.repository_id);
  const mapping = supporting.mappings.get(mappingKey(result));
  if (!repository || !mapping || repository.organisation_id !== organisationId) fail();
  const source = parseSafeGitHubRepositorySource({ name: repository.full_name, url: repository.html_url });
  return {
    repository: { id: repository.id, name: source.name, url: source.url },
    checkId: result.check_id,
    catalogueSummary: result.catalogue_summary,
    observedAt: result.observed_at,
    freshUntil: result.fresh_until,
    materialisedAt: result.materialised_at,
    freshness: Date.parse(result.fresh_until) > Date.parse(asOf) ? "current" : "stale",
    ruleVersion: result.rule_version,
    mappingVersion: result.mapping_version,
    mappingChecksum: result.mapping_checksum,
    isoControlReferences: [...mapping.iso_control_references],
  };
}

export async function loadOfficialGitHubEvidenceProvenance(
  supabase: SupabaseClient,
  organisationId: string,
  evidenceIds: string[],
  asOfValue = new Date().toISOString(),
): Promise<OfficialGitHubEvidenceProvenance[]> {
  const parsedOrganisationId = uuid.safeParse(organisationId);
  const parsedIds = parseIdList(evidenceIds);
  const asOf = parseAsOf(asOfValue);
  if (!parsedOrganisationId.success) fail();
  if (parsedIds.length === 0) return [];

  try {
    const [provenanceResult, ledgerResult] = await Promise.all([
      supabase.from("github_evidence_provenance")
        .select("evidence_id,organisation_id,repository_id,observation_id,mapping_pack_id,check_id,rule_version,mapping_version,observed_at,fresh_until,created_at")
        .eq("organisation_id", parsedOrganisationId.data)
        .in("evidence_id", parsedIds)
        .limit(MAX_RECORDS),
      supabase.from("github_official_compliance_results")
        .select("organisation_id,evidence_id")
        .eq("organisation_id", parsedOrganisationId.data)
        .in("evidence_id", parsedIds)
        .limit(MAX_RECORDS),
    ]);
    const provenance = z.array(evidenceProvenanceRow).max(MAX_RECORDS).safeParse(provenanceResult.data);
    const ledger = z.array(officialEvidenceLedgerRow).max(MAX_RECORDS).safeParse(ledgerResult.data);
    if (provenanceResult.error || !provenance.success || ledgerResult.error || !ledger.success) fail();
    const byEvidence = uniqueBy(provenance.data, (row) => row.evidence_id);
    const ledgerByEvidence = uniqueBy(ledger.data, (row) => row.evidence_id);
    for (const row of [...provenance.data, ...ledger.data]) {
      if (row.organisation_id !== parsedOrganisationId.data || !parsedIds.includes(row.evidence_id)) fail();
    }
    if (byEvidence.size !== ledgerByEvidence.size
      || [...byEvidence.keys()].some((evidenceId) => !ledgerByEvidence.has(evidenceId))) fail();
    const supporting = await loadSupportingRows(supabase, parsedOrganisationId.data, provenance.data.map((row) => row.observation_id));

    return parsedIds.flatMap((evidenceId) => {
      const row = byEvidence.get(evidenceId);
      if (!row) return [];
      const result = supporting.results.get(row.observation_id);
      if (!result
        || row.organisation_id !== parsedOrganisationId.data
        || result.organisation_id !== parsedOrganisationId.data
        || result.outcome !== "pass"
        || result.failure_severity !== null
        || result.evidence_id !== evidenceId
        || result.finding_id !== null
        || result.repository_id !== row.repository_id
        || result.mapping_pack_id !== row.mapping_pack_id
        || result.mapping_version !== row.mapping_version
        || result.check_id !== row.check_id
        || result.rule_version !== row.rule_version
        || result.observed_at !== row.observed_at
        || result.fresh_until !== row.fresh_until) fail();
      return [{ evidenceId, ...commonRecord(parsedOrganisationId.data, asOf, result, supporting) }];
    });
  } catch {
    fail();
  }
}

export async function loadOfficialGitHubFindingProvenance(
  supabase: SupabaseClient,
  organisationId: string,
  targets: FindingTarget[],
  asOfValue = new Date().toISOString(),
): Promise<OfficialGitHubFindingProvenance[]> {
  const parsedOrganisationId = uuid.safeParse(organisationId);
  const parsedTargets = z.array(z.object({ findingId: uuid, status: activeStatus }).strict()).max(100).safeParse(targets);
  const asOf = parseAsOf(asOfValue);
  if (!parsedOrganisationId.success || !parsedTargets.success
    || new Set(parsedTargets.data.map((target) => target.findingId)).size !== parsedTargets.data.length) fail();
  if (parsedTargets.data.length === 0) return [];

  try {
    const findingIds = parsedTargets.data.map((target) => target.findingId);
    const provenanceResult = await supabase.from("github_finding_provenance")
      .select("finding_id,organisation_id,latest_repository_id,latest_observation_id,latest_mapping_pack_id,check_id,mapping_version,first_detected_at,most_recent_detected_at,resolved_at")
      .eq("organisation_id", parsedOrganisationId.data)
      .in("finding_id", findingIds)
      .limit(100);
    const provenance = z.array(findingProvenanceRow).max(100).safeParse(provenanceResult.data);
    if (provenanceResult.error || !provenance.success) fail();
    const byFinding = uniqueBy(provenance.data, (row) => row.finding_id);
    if (byFinding.size !== parsedTargets.data.length) fail();
    const supporting = await loadSupportingRows(supabase, parsedOrganisationId.data, provenance.data.map((row) => row.latest_observation_id));

    return parsedTargets.data.flatMap((target) => {
      const row = byFinding.get(target.findingId);
      if (!row) return [];
      const result = supporting.results.get(row.latest_observation_id);
      if (!result
        || row.organisation_id !== parsedOrganisationId.data
        || row.resolved_at !== null
        || Date.parse(row.most_recent_detected_at) < Date.parse(row.first_detected_at)
        || result.organisation_id !== parsedOrganisationId.data
        || result.outcome !== "fail"
        || result.failure_severity === null
        || result.finding_id !== target.findingId
        || result.evidence_id !== null
        || result.repository_id !== row.latest_repository_id
        || result.mapping_pack_id !== row.latest_mapping_pack_id
        || result.mapping_version !== row.mapping_version
        || result.check_id !== row.check_id
        || result.observed_at !== row.most_recent_detected_at) fail();
      return [{
        findingId: target.findingId,
        severity: result.failure_severity,
        firstDetectedAt: row.first_detected_at,
        mostRecentDetectedAt: row.most_recent_detected_at,
        allowedTransitions: GITHUB_FINDING_TRANSITION_STATUSES.filter((status) => status !== target.status),
        ...commonRecord(parsedOrganisationId.data, asOf, result, supporting),
      }];
    });
  } catch {
    fail();
  }
}
