import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type ClientOptions,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import { decodeJwt } from "jose";
import { z } from "zod";

const DEFAULT_ENDPOINT = "http://127.0.0.1:3100/mcp";
const DEFAULT_CALLBACK_PORT = 18765;
const DEFAULT_OUTPUT = "artifacts/phase3-0-mcp-foundation-proof.json";
const CURRENT_PROTOCOL = "2026-07-28" as const;
const LEGACY_PROTOCOL = "2025-11-25" as const;
const REQUIRED_SCOPES = "openid email profile";
const MAX_PAGES = 500;
const DOCKER_BIN = "/opt/homebrew/bin/docker";
const DEFAULT_DATABASE_CONTAINER = "supabase_db_compliancehub";
const PROTECTED_STATE_SCOPE = "tenant-compliance-state-plus-global-github-mapping-catalogue" as const;
const REQUIRED_TOOL_NAMES = Object.freeze([
  "list_workspaces",
  "get_compliance_overview",
  "list_attention_items",
  "list_monitoring_findings",
  "list_github_compliance_results",
  "get_latest_leadership_report",
  "prepare_daily_digest",
] as const);
export const PROTECTED_DOMAIN_TABLES = Object.freeze({
  githubInstallations: "github_installations",
  githubRepositories: "github_repositories",
  githubWebhookDeliveries: "github_webhook_deliveries",
  githubOfficialResults: "github_official_compliance_results",
  githubMaterialisationJobs: "github_materialisation_jobs",
  githubCollectionRuns: "github_collection_runs",
  githubObservations: "github_observations",
  githubMappingApprovals: "github_mapping_approvals",
  githubEvidenceProvenance: "github_evidence_provenance",
  githubFindingProvenance: "github_finding_provenance",
  githubFindingTransitions: "github_finding_transitions",
  evidence: "evidence",
  evidenceLinks: "evidence_links",
  evidenceSources: "evidence_sources",
  monitoringFindings: "monitoring_findings",
  integrationConnections: "integration_connections",
  notifications: "notifications",
  dailyDigestDeliveries: "daily_digest_deliveries",
  dailyDigestDeliveryAttempts: "daily_digest_delivery_attempts",
  githubMappingPacks: "github_mapping_packs",
  githubMappingEntries: "github_mapping_entries",
} as const);
const RECONCILIATION_PROJECTIONS = Object.freeze({
  github_official_compliance_results: "id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,failure_severity,catalogue_summary,observed_at,fresh_until,materialised_at,evidence_id,finding_id",
  github_observations: "id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,fingerprint",
  github_collection_runs: "id,organisation_id,installation_id,repository_id,provider_repository_id,run_mode,status,completed_at",
  github_mapping_approvals: "id,organisation_id,mapping_pack_id,approved_at,revoked_at",
  github_mapping_packs: "id,version,checksum,published_at",
} as const);

const resultSchema = z.object({
  id: z.string().regex(/^github_result:[0-9a-f-]{36}$/),
  repositoryId: z.string().uuid(),
  repositoryLabel: z.string().regex(/^GitHub repository [0-9a-f]{8}$/),
  collectionRunId: z.string().regex(/^github_run:[0-9a-f-]{36}$/),
  runMode: z.literal("official"),
  checkId: z.string().min(1).max(120).regex(/^[a-z0-9._-]+$/),
  result: z.enum(["pass", "fail", "unknown", "not_applicable"]),
  severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
  observedAt: z.string().datetime({ offset: true }),
  freshUntil: z.string().datetime({ offset: true }),
  materialisedAt: z.string().datetime({ offset: true }),
  freshness: z.enum(["current", "stale"]),
  mappingVersion: z.string().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  mappingChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  mappingStatus: z.enum(["active", "historical"]),
  ruleVersion: z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/),
  sourceResponseFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  summary: z.string().min(1).max(280),
  evidenceId: z.string().regex(/^evidence:[0-9a-f-]{36}$/).nullable(),
  findingId: z.string().regex(/^monitoring_finding:[0-9a-f-]{36}$/).nullable(),
  recordHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
const expectedResultSchema = resultSchema.omit({ recordHash: true });

const workspaceResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    workspaces: z.array(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(160),
      role: z.enum(["owner", "admin", "member"]),
    }).strict()),
  }).strict(),
}).strict();

const githubResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    schemaVersion: z.literal(2),
    workspace: z.object({ id: z.string().uuid(), name: z.string().min(1).max(160) }).strict(),
    snapshotAt: z.string().datetime({ offset: true }),
    results: z.array(resultSchema),
    nextCursor: z.string().nullable(),
    truncated: z.boolean(),
    pageKind: z.enum(["initial", "continuation"]),
    pageHash: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
}).strict();

const storedOfficialResultSchema = z.object({
  id: z.string().uuid(), organisation_id: z.string().uuid(), installation_id: z.string().uuid(),
  repository_id: z.string().uuid(), provider_repository_id: z.number().int().positive(),
  collection_run_id: z.string().uuid(), observation_id: z.string().uuid(), approval_id: z.string().uuid(),
  mapping_pack_id: z.string().uuid(), mapping_version: z.string(), mapping_checksum: z.string(),
  check_id: z.string(), rule_version: z.string(), outcome: z.enum(["pass", "fail", "unknown", "not_applicable"]),
  failure_severity: z.enum(["low", "medium", "high", "critical"]).nullable(), catalogue_summary: z.string(),
  observed_at: z.string().datetime({ offset: true }),
  fresh_until: z.string().datetime({ offset: true }), materialised_at: z.string().datetime({ offset: true }),
  evidence_id: z.string().uuid().nullable(), finding_id: z.string().uuid().nullable(),
}).strict();
const storedObservationSchema = z.object({
  id: z.string().uuid(), organisation_id: z.string().uuid(), installation_id: z.string().uuid(),
  repository_id: z.string().uuid(), provider_repository_id: z.number().int().positive(), collection_run_id: z.string().uuid(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
const storedRunSchema = z.object({
  id: z.string().uuid(), organisation_id: z.string().uuid(), installation_id: z.string().uuid(),
  repository_id: z.string().uuid(), provider_repository_id: z.number().int().positive(),
  run_mode: z.enum(["official", "shadow"]), status: z.enum(["running", "succeeded", "partial", "failed", "rate_limited"]),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
const storedApprovalSchema = z.object({
  id: z.string().uuid(), organisation_id: z.string().uuid(), mapping_pack_id: z.string().uuid(),
  approved_at: z.string().datetime({ offset: true }), revoked_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
const storedPackSchema = z.object({
  id: z.string().uuid(), version: z.string(), checksum: z.string().nullable(), published_at: z.string().datetime({ offset: true }).nullable(),
}).strict();

export type GitHubProofResult = z.infer<typeof resultSchema>;
type StoredOfficialResult = z.infer<typeof storedOfficialResultSchema>;
type StoredObservation = z.infer<typeof storedObservationSchema>;
type StoredRun = z.infer<typeof storedRunSchema>;

type CursorRedaction = { present: true; sha256Prefix: string };
type ProtectedDomainSnapshot = Record<string, { rowCount: number; sha256: string }>;
type ExpectedOfficialResult = Omit<GitHubProofResult, "recordHash">;

export type AcceptanceAnswer = {
  question: string;
  supported: boolean;
  answer: string;
};

export type Phase3ProofTool = {
  name: typeof REQUIRED_TOOL_NAMES[number];
  readOnly: true;
  destructive: false;
  openWorld: false;
  idempotent: true;
};

export type Phase3Proof = {
  schemaVersion: 2;
  generatedAt: string;
  endpoint: string;
  protocols: { current: typeof CURRENT_PROTOCOL; legacy: typeof LEGACY_PROTOCOL };
  negotiatedProtocol: typeof CURRENT_PROTOCOL | typeof LEGACY_PROTOCOL;
  oauth: {
    discovery: boolean;
    dynamicClientRegistration: boolean;
    grant: "authorization-code";
    pkce: "S256";
    stateValidated: boolean;
    consent: "approved";
    audienceMatched: boolean;
  };
  server: { name: string; version: "0.4.0"; initialized: boolean };
  tools: Phase3ProofTool[];
  workspaceRead: true;
  githubRead: {
    readOnly: boolean;
    destructive: boolean;
    openWorld: boolean;
    initialRequestHadCursor: false;
    limit: 1;
    pages: Array<{ pageKind: "initial" | "continuation"; resultCount: number; nextCursor: CursorRedaction | null }>;
    traversedToNull: boolean;
    totalResults: number;
  };
  databaseUnchanged: true;
  database: {
    scope: typeof PROTECTED_STATE_SCOPE;
    before: ProtectedDomainSnapshot;
    after: ProtectedDomainSnapshot;
    unchanged: boolean;
    reconciliation: {
      mcpResultCount: number;
      databaseResultCount: number;
      matched: boolean;
      resultSetHash: string;
    };
  };
  observations: {
    clientNetwork: { scope: "proof-client-process"; loopbackOnly: boolean; githubCalls: number; slackCalls: number };
    invokedTools: { listWorkspaces: number; githubReadPages: number; writeTools: string[] };
    staticServerCallPath: {
      scope: "reviewed-source";
      databaseReadOnly: boolean;
      githubProviderReachable: boolean;
      slackWriteReachable: boolean;
    };
  };
  answers: AcceptanceAnswer[];
};

type Phase3ProofInput = Omit<Phase3Proof, "schemaVersion" | "protocols">;

const protectedSnapshotSchema = z.record(
  z.string(),
  z.object({ rowCount: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
).superRefine((snapshot, context) => {
  const actual = Object.keys(snapshot).sort();
  const expected = Object.keys(PROTECTED_DOMAIN_TABLES).sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    context.addIssue({ code: "custom", message: "protected domain snapshot is incomplete" });
  }
});

const proofSchema: z.ZodType<Phase3Proof> = z.object({
  schemaVersion: z.literal(2),
  generatedAt: z.string().datetime({ offset: true }),
  endpoint: z.literal(DEFAULT_ENDPOINT),
  protocols: z.object({ current: z.literal(CURRENT_PROTOCOL), legacy: z.literal(LEGACY_PROTOCOL) }).strict(),
  negotiatedProtocol: z.enum([CURRENT_PROTOCOL, LEGACY_PROTOCOL]),
  oauth: z.object({
    discovery: z.literal(true), dynamicClientRegistration: z.literal(true), grant: z.literal("authorization-code"),
    pkce: z.literal("S256"), stateValidated: z.literal(true), consent: z.literal("approved"), audienceMatched: z.literal(true),
  }).strict(),
  server: z.object({ name: z.literal("compliancehub-internal"), version: z.literal("0.4.0"), initialized: z.literal(true) }).strict(),
  tools: z.array(z.object({
    name: z.enum(REQUIRED_TOOL_NAMES), readOnly: z.literal(true), destructive: z.literal(false),
    openWorld: z.literal(false), idempotent: z.literal(true),
  }).strict()).length(REQUIRED_TOOL_NAMES.length),
  workspaceRead: z.literal(true),
  githubRead: z.object({
    readOnly: z.literal(true), destructive: z.literal(false), openWorld: z.literal(false),
    initialRequestHadCursor: z.literal(false), limit: z.literal(1),
    pages: z.array(z.object({
      pageKind: z.enum(["initial", "continuation"]), resultCount: z.number().int().nonnegative(),
      nextCursor: z.object({ present: z.literal(true), sha256Prefix: z.string().regex(/^[0-9a-f]{12}$/) }).strict().nullable(),
    }).strict()).min(1),
    traversedToNull: z.literal(true), totalResults: z.number().int().nonnegative(),
  }).strict(),
  databaseUnchanged: z.literal(true),
  database: z.object({
    scope: z.literal(PROTECTED_STATE_SCOPE),
    before: protectedSnapshotSchema,
    after: protectedSnapshotSchema,
    unchanged: z.literal(true),
    reconciliation: z.object({
      mcpResultCount: z.number().int().nonnegative(), databaseResultCount: z.number().int().nonnegative(),
      matched: z.literal(true), resultSetHash: z.string().regex(/^[0-9a-f]{64}$/),
    }).strict(),
  }).strict(),
  observations: z.object({
    clientNetwork: z.object({
      scope: z.literal("proof-client-process"), loopbackOnly: z.literal(true), githubCalls: z.literal(0), slackCalls: z.literal(0),
    }).strict(),
    invokedTools: z.object({
      listWorkspaces: z.literal(1), githubReadPages: z.number().int().positive(), writeTools: z.array(z.string()).length(0),
    }).strict(),
    staticServerCallPath: z.object({
      scope: z.literal("reviewed-source"), databaseReadOnly: z.literal(true),
      githubProviderReachable: z.literal(false), slackWriteReachable: z.literal(false),
    }).strict(),
  }).strict(),
  answers: z.array(z.object({ question: z.string().min(1), supported: z.boolean(), answer: z.string().min(1) }).strict()).length(5),
}).strict();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildProtectedDomainSnapshot(rowsByDomain: Record<string, unknown[]>): ProtectedDomainSnapshot {
  return Object.fromEntries(Object.entries(rowsByDomain)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, rows]) => {
      const canonicalRows = rows.map(canonicalJson).sort();
      return [domain, { rowCount: rows.length, sha256: sha256(canonicalRows.join("\n")) }];
    }));
}

export function parseProtectedDomainDigest(value: unknown): ProtectedDomainSnapshot {
  let decoded: unknown = value;
  if (typeof value === "string") {
    try { decoded = JSON.parse(value); } catch { throw new Error("Protected-domain digest response was not valid JSON."); }
  }
  const parsed = z.object({
    readOnly: z.literal(true),
    scope: z.literal(PROTECTED_STATE_SCOPE),
    tables: protectedSnapshotSchema,
  }).strict().safeParse(decoded);
  if (!parsed.success) throw new Error("Protected-domain digest response was invalid or contained non-digest data.");
  return parsed.data.tables;
}

export function deriveExpectedOfficialResults(input: {
  officialRows: unknown[];
  observations: unknown[];
  runs: unknown[];
  approvals: unknown[];
  packs: unknown[];
  snapshotAt: string;
}) {
  const snapshot = new Date(z.string().datetime({ offset: true }).parse(input.snapshotAt)).getTime();
  const officialRows = z.array(storedOfficialResultSchema).parse(input.officialRows);
  const observations = new Map(z.array(storedObservationSchema).parse(input.observations).map((row) => [row.id, row]));
  const runs = new Map(z.array(storedRunSchema).parse(input.runs).map((row) => [row.id, row]));
  const approvals = new Map(z.array(storedApprovalSchema).parse(input.approvals).map((row) => [row.id, row]));
  const packs = new Map(z.array(storedPackSchema).parse(input.packs).map((row) => [row.id, row]));
  const sameAncestry = (result: StoredOfficialResult, row: StoredObservation | StoredRun) =>
    row.organisation_id === result.organisation_id
    && row.installation_id === result.installation_id
    && row.repository_id === result.repository_id
    && row.provider_repository_id === result.provider_repository_id
    && ("collection_run_id" in row ? row.collection_run_id === result.collection_run_id : row.id === result.collection_run_id);
  const eligible = officialRows.filter((result) => {
    const observation = observations.get(result.observation_id);
    const run = runs.get(result.collection_run_id);
    return new Date(result.materialised_at).getTime() <= snapshot
      && observation !== undefined && sameAncestry(result, observation)
      && run !== undefined && sameAncestry(result, run)
      && run.run_mode === "official"
      && (run.status === "succeeded" || run.status === "partial")
      && run.completed_at !== null;
  });
  const latest = new Map<string, StoredOfficialResult>();
  for (const result of eligible) {
    const key = `${result.provider_repository_id}\0${result.check_id}`;
    const previous = latest.get(key);
    if (!previous || result.observed_at > previous.observed_at || (result.observed_at === previous.observed_at && result.id > previous.id)) {
      latest.set(key, result);
    }
  }
  return [...latest.values()]
    .sort((left, right) => right.observed_at.localeCompare(left.observed_at) || right.id.localeCompare(left.id))
    .map((result) => {
      const approval = approvals.get(result.approval_id);
      const pack = packs.get(result.mapping_pack_id);
      const observation = observations.get(result.observation_id)!;
      const active = approval !== undefined
        && approval.organisation_id === result.organisation_id
        && approval.mapping_pack_id === result.mapping_pack_id
        && new Date(approval.approved_at).getTime() <= snapshot
        && (approval.revoked_at === null || new Date(approval.revoked_at).getTime() > snapshot)
        && pack !== undefined
        && pack.version === result.mapping_version
        && pack.checksum === result.mapping_checksum
        && pack.published_at !== null
        && new Date(pack.published_at).getTime() <= snapshot;
      return {
        id: `github_result:${result.id}`,
        repositoryId: result.repository_id,
        repositoryLabel: `GitHub repository ${result.repository_id.slice(0, 8)}`,
        collectionRunId: `github_run:${result.collection_run_id}`,
        runMode: "official" as const,
        checkId: result.check_id,
        result: result.outcome,
        severity: result.failure_severity,
        observedAt: new Date(result.observed_at).toISOString(),
        freshUntil: new Date(result.fresh_until).toISOString(),
        materialisedAt: new Date(result.materialised_at).toISOString(),
        freshness: new Date(result.fresh_until).getTime() > snapshot ? "current" as const : "stale" as const,
        mappingVersion: result.mapping_version,
        mappingChecksum: result.mapping_checksum,
        mappingStatus: active ? "active" as const : "historical" as const,
        ruleVersion: result.rule_version,
        sourceResponseFingerprint: observation.fingerprint,
        summary: result.catalogue_summary,
        evidenceId: result.evidence_id === null ? null : `evidence:${result.evidence_id}`,
        findingId: result.finding_id === null ? null : `monitoring_finding:${result.finding_id}`,
      };
    });
}

function comparableResult(row: GitHubProofResult): ExpectedOfficialResult {
  const { recordHash: _recordHash, ...comparable } = resultSchema.parse(row);
  void _recordHash;
  return {
    ...comparable,
    observedAt: new Date(comparable.observedAt).toISOString(),
    freshUntil: new Date(comparable.freshUntil).toISOString(),
    materialisedAt: new Date(comparable.materialisedAt).toISOString(),
  };
}

export function reconcileOfficialResults(mcpRows: GitHubProofResult[], databaseRows: ExpectedOfficialResult[]) {
  const mcp = z.array(resultSchema).parse(mcpRows).map(comparableResult).sort((left, right) => left.id.localeCompare(right.id));
  const database = z.array(expectedResultSchema).parse(databaseRows).map((row) => ({
    ...row,
    observedAt: new Date(row.observedAt).toISOString(),
    freshUntil: new Date(row.freshUntil).toISOString(),
    materialisedAt: new Date(row.materialisedAt).toISOString(),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const mcpCanonical = canonicalJson(mcp);
  const databaseCanonical = canonicalJson(database);
  return {
    mcpResultCount: mcp.length,
    databaseResultCount: database.length,
    matched: mcpCanonical === databaseCanonical,
    resultSetHash: sha256(mcpCanonical),
  };
}

export function redactCursor(cursor: string | null): CursorRedaction | null {
  if (cursor === null) return null;
  return { present: true, sha256Prefix: createHash("sha256").update(cursor, "utf8").digest("hex").slice(0, 12) };
}

function factList(rows: GitHubProofResult[]) {
  if (!rows.length) return "None were returned by the exhaustive MCP read.";
  return rows.map((row) => `${row.checkId}: ${row.summary}`).join(" ");
}

export function createAcceptanceAnswers(results: GitHubProofResult[]): AcceptanceAnswer[] {
  const currentFailures = results.filter((row) => row.result === "fail" && row.freshness === "current" && row.mappingStatus === "active");
  const unknowns = results.filter((row) => row.result === "unknown");
  const stale = results.filter((row) => row.freshness === "stale");
  const priority = [...currentFailures, ...unknowns, ...stale].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
  return [
    {
      question: "Which GitHub checks currently fail?",
      supported: true,
      answer: factList(currentFailures),
    },
    {
      question: "Which information is unknown or unavailable?",
      supported: true,
      answer: factList(unknowns),
    },
    {
      question: "Which results are stale or need rechecking?",
      supported: true,
      answer: factList(stale),
    },
    {
      question: "What changed and what should we prioritise?",
      supported: false,
      answer: `This MCP result view does not include verified change history, so it cannot claim what changed. Prioritise the returned current failures, then unknown and stale results: ${factList(priority)}`,
    },
    {
      question: "Does this prove ISO 27001 certification?",
      supported: true,
      answer: "No. This does not prove ISO 27001 certification, overall compliance, readiness, or security.",
    },
  ];
}

export function buildPhase3Proof(input: Phase3ProofInput): Phase3Proof {
  return {
    schemaVersion: 2,
    protocols: { current: CURRENT_PROTOCOL, legacy: LEGACY_PROTOCOL },
    ...input,
  };
}

function containsSensitiveData(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  const secretFieldPattern = [
    ["access", "token"],
    ["refresh", "token"],
    ["id", "token"],
    ["authorization", "code"],
    ["client", "secret"],
    ["private", "key"],
    ["webhook", "url"],
    ["service", "role", "key"],
    ["email"],
    ["provider", "payload"],
    ["credential"],
    ["credentials"],
    ["destination"],
  ].map((parts) => parts.join("_?")).join("|");
  const secretKey = new RegExp(`"(?:${secretFieldPattern})"\\s*:`, "i");
  const secretValue = /(?:Bearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|hooks\.slack\.com|xox[baprs]-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9]+|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\bch[34]\.[A-Za-z0-9_.-]{8,}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;
  return secretKey.test(serialized) || secretValue.test(serialized);
}

export function validateProofForPersistence(value: unknown): asserts value is Phase3Proof {
  if (containsSensitiveData(value)) throw new Error("Phase 3 proof contains sensitive data.");
  const parsed = proofSchema.safeParse(value);
  if (!parsed.success) throw new Error("Phase 3 proof does not satisfy the completed read-only contract.");
  if (canonicalJson(parsed.data.tools.map((tool) => tool.name)) !== canonicalJson(REQUIRED_TOOL_NAMES)) {
    throw new Error("Phase 3 proof tool catalogue is not the exact seven-tool read-only contract.");
  }
  const { pages, totalResults } = parsed.data.githubRead;
  if (totalResults === 0) {
    throw new Error("Phase 3 proof requires at least one stored official Phase 1 result.");
  }
  if (pages[0]?.pageKind !== "initial" || pages.slice(1).some((page) => page.pageKind !== "continuation")) {
    throw new Error("Phase 3 proof pagination sequence is invalid.");
  }
  if (pages.some((page, index) => index < pages.length - 1 ? page.nextCursor === null : page.nextCursor !== null)) {
    throw new Error("Phase 3 proof must use continuation cursors until one final null cursor.");
  }
  if (pages.some((page) => page.resultCount !== 1) || pages.reduce((sum, page) => sum + page.resultCount, 0) !== totalResults) {
    throw new Error("Phase 3 proof page counts do not match the exhaustive result count.");
  }
  const reconciliation = parsed.data.database.reconciliation;
  if (reconciliation.mcpResultCount !== totalResults
    || reconciliation.databaseResultCount !== totalResults
    || !reconciliation.matched) {
    throw new Error("Phase 3 proof result counts do not reconcile.");
  }
  if (parsed.data.observations.invokedTools.githubReadPages !== pages.length) {
    throw new Error("Phase 3 proof tool invocation count does not match its pages.");
  }
  if (!parsed.data.databaseUnchanged || canonicalJson(parsed.data.database.before) !== canonicalJson(parsed.data.database.after)) {
    throw new Error("Phase 3 proof protected-domain snapshots changed during the read.");
  }
  const expectedAnswers = [
    "Which GitHub checks currently fail?",
    "Which information is unknown or unavailable?",
    "Which results are stale or need rechecking?",
    "What changed and what should we prioritise?",
    "Does this prove ISO 27001 certification?",
  ];
  if (parsed.data.answers.some((answer, index) => answer.question !== expectedAnswers[index])) {
    throw new Error("Phase 3 proof acceptance questions changed.");
  }
  if (parsed.data.answers.slice(0, 3).some((answer) => !answer.supported)
    || parsed.data.answers[3]?.supported !== false
    || !/does not include verified change history/i.test(parsed.data.answers[3]?.answer ?? "")) {
    throw new Error("Phase 3 proof must refuse unsupported change-history claims.");
  }
  if (parsed.data.answers[4]?.supported !== true
    || !/^No\b.*does not prove ISO 27001 certification/i.test(parsed.data.answers[4]?.answer ?? "")) {
    throw new Error("Phase 3 proof must explicitly refuse an ISO 27001 certification claim.");
  }
}

export async function writeProofArtifact(outputPath: string, proof: Phase3Proof) {
  validateProofForPersistence(proof);
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, `${JSON.stringify(proof, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(absolutePath, 0o600);
}

class ProofOAuthProvider implements OAuthClientProvider {
  private information?: OAuthClientInformationMixed;
  private oauthTokens?: OAuthTokens;
  private verifier?: string;
  private discovery?: OAuthDiscoveryState;

  constructor(
    readonly redirectUrl: URL,
    readonly clientMetadata: OAuthClientMetadata,
    private readonly expectedState: string,
    private readonly onRedirect: (url: URL) => void,
  ) {}

  state() { return this.expectedState; }
  clientInformation() { return this.information; }
  saveClientInformation(value: OAuthClientInformationMixed) { this.information = value; }
  tokens() { return this.oauthTokens; }
  saveTokens(value: OAuthTokens) { this.oauthTokens = value; }
  redirectToAuthorization(url: URL) { this.onRedirect(url); }
  saveCodeVerifier(value: string) { this.verifier = value; }
  codeVerifier() {
    if (!this.verifier) throw new Error("OAuth PKCE verifier was not saved.");
    return this.verifier;
  }
  saveDiscoveryState(value: OAuthDiscoveryState) { this.discovery = value; }
  discoveryState() { return this.discovery; }
}

type CallbackReceiver = {
  callbackUrl: URL;
  authorizationHandoffUrl: URL;
  code: Promise<string>;
  setAuthorizationUrl: (url: URL) => void;
  close: () => Promise<void>;
  stateWasValidated: () => boolean;
};

async function createCallbackReceiver(port: number, expectedState: string): Promise<CallbackReceiver> {
  let stateValidated = false;
  let authorizationUrl: URL | undefined;
  let resolveCode!: (value: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveCode = resolvePromise;
    rejectCode = rejectPromise;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/authorize") {
      if (!authorizationUrl) {
        response.writeHead(503, { "content-type": "text/plain", "cache-control": "no-store" });
        response.end("Authorization is not ready.");
        return;
      }
      response.writeHead(302, { location: authorizationUrl.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" });
      response.end();
      return;
    }
    if (request.method !== "GET" || url.pathname !== "/callback") {
      response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("Not found");
      return;
    }
    const error = url.searchParams.get("error");
    const returnedState = url.searchParams.get("state");
    const authorizationCode = url.searchParams.get("code");
    if (error || !authorizationCode || returnedState !== expectedState) {
      response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("Authorization could not be completed.");
      rejectCode(new Error("OAuth callback was rejected."));
      return;
    }
    stateValidated = true;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end("<!doctype html><title>ComplianceHub connected</title><h1>Connection approved</h1><p>You can close this tab.</p>");
    resolveCode(authorizationCode);
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  const timeout = setTimeout(() => rejectCode(new Error("OAuth approval was not received within five minutes.")), 5 * 60_000);
  timeout.unref();
  return {
    callbackUrl: new URL(`http://127.0.0.1:${port}/callback`),
    authorizationHandoffUrl: new URL(`http://127.0.0.1:${port}/authorize`),
    code: code.finally(() => clearTimeout(timeout)),
    setAuthorizationUrl: (url) => { authorizationUrl = new URL(url); },
    close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
    stateWasValidated: () => stateValidated,
  };
}

function isLoopback(url: URL) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
}

function trackedLocalFetch(ledger: { githubCalls: number; slackCalls: number; nonLocalCalls: number }) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === "api.github.com" || url.hostname === "github.com") ledger.githubCalls += 1;
    if (url.hostname === "hooks.slack.com" || url.hostname === "slack.com") ledger.slackCalls += 1;
    if (!isLoopback(url)) ledger.nonLocalCalls += 1;
    if (!isLoopback(url)) throw new Error("The Phase 2 local proof blocks non-loopback network calls.");
    return nativeFetch(input, init);
  };
}

export function requireLocalPostgresSettings(environment: Record<string, string | undefined>) {
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() || "http://127.0.0.1:54321";
  const parsedUrl = new URL(supabaseUrl);
  if (!isLoopback(parsedUrl) || parsedUrl.protocol !== "http:") {
    throw new Error("The Phase 2 proof requires a local Supabase boundary.");
  }
  const databaseContainer = environment.MCP_PROOF_DB_CONTAINER?.trim() || DEFAULT_DATABASE_CONTAINER;
  if (!/^supabase_db_[a-z0-9][a-z0-9_-]{0,63}$/.test(databaseContainer)) {
    throw new Error("MCP_PROOF_DB_CONTAINER is not a safe local Supabase database container name.");
  }
  const dockerHost = environment.DOCKER_HOST?.trim();
  if (dockerHost && !/^unix:\/\/(?:\/var\/run\/docker\.sock|\/Users\/[^/]+\/\.colima\/[A-Za-z0-9_-]+\/docker\.sock)$/.test(dockerHost)) {
    throw new Error("A remote Docker host is forbidden for the Phase 2 proof.");
  }
  const dockerContext = environment.DOCKER_CONTEXT?.trim();
  if (dockerContext && dockerContext !== "default" && dockerContext !== "colima") {
    throw new Error("A remote Docker context is forbidden for the Phase 2 proof.");
  }
  return { supabaseUrl, databaseContainer };
}

function checkedWorkspaceId(workspaceId: string) {
  return z.string().uuid().parse(workspaceId);
}

function readOnlyEnvelope(body: string) {
  return `begin transaction read only;\nselect (${body})::text;\ncommit;`;
}

export function buildProtectedDomainSnapshotQuery(workspaceId: string) {
  const workspace = checkedWorkspaceId(workspaceId);
  const tableDigests = Object.entries(PROTECTED_DOMAIN_TABLES).map(([label, table]) => {
    const global = table === "github_mapping_packs" || table === "github_mapping_entries";
    const filter = global ? "" : ` where source_row.organisation_id = '${workspace}'::uuid`;
    const digest = `(select jsonb_build_object('rowCount', count(*), 'sha256', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(jsonb_agg(to_jsonb(source_row) order by source_row.id)::text, '[]'), 'UTF8'), 'sha256'), 'hex')) from public.${table} as source_row${filter})`;
    return `'${label}', ${digest}`;
  }).join(",\n");
  return readOnlyEnvelope(`jsonb_build_object(
    'readOnly', current_setting('transaction_read_only') = 'on',
    'scope', '${PROTECTED_STATE_SCOPE}',
    'tables', jsonb_build_object(${tableDigests})
  )`);
}

function projectedRows(table: keyof typeof RECONCILIATION_PROJECTIONS, workspace: string | null) {
  const columns = RECONCILIATION_PROJECTIONS[table];
  if (columns.includes("*")) throw new Error("A wildcard reconciliation projection is forbidden.");
  const filter = workspace === null ? "" : ` where organisation_id = '${workspace}'::uuid`;
  return `(select coalesce(jsonb_agg(to_jsonb(projected) order by projected.id), '[]'::jsonb) from (select ${columns} from public.${table}${filter} order by id) as projected)`;
}

export function buildReconciliationQuery(workspaceId: string) {
  const workspace = checkedWorkspaceId(workspaceId);
  return readOnlyEnvelope(`jsonb_build_object(
    'readOnly', current_setting('transaction_read_only') = 'on',
    'officialRows', ${projectedRows("github_official_compliance_results", workspace)},
    'observations', ${projectedRows("github_observations", workspace)},
    'runs', ${projectedRows("github_collection_runs", workspace)},
    'approvals', ${projectedRows("github_mapping_approvals", workspace)},
    'packs', ${projectedRows("github_mapping_packs", null)}
  )`);
}

export function validateLocalDockerContext(input: { contextName: string; host: string }) {
  if ((input.contextName !== "default" && input.contextName !== "colima")
    || !/^unix:\/\/(?:\/var\/run\/docker\.sock|\/Users\/[^/]+\/\.colima\/[A-Za-z0-9_-]+\/docker\.sock)$/.test(input.host)) {
    throw new Error("The Phase 2 proof requires a local Unix or Colima Docker context.");
  }
}

type DockerIdentity = {
  name: string;
  running: boolean;
  image: string;
  composeProject: string;
  supabaseProject: string;
  networks: string[];
  aliases: string[];
};

export function validateDockerIdentity(identity: DockerIdentity, databaseContainer: string) {
  const project = databaseContainer.slice("supabase_db_".length);
  if (identity.name !== `/${databaseContainer}`
    || !identity.running
    || !/^public\.ecr\.aws\/supabase\/postgres:[A-Za-z0-9._-]+$/.test(identity.image)
    || identity.composeProject !== project
    || identity.supabaseProject !== project) {
    throw new Error("The local Supabase PostgreSQL container identity did not match.");
  }
  const expectedNetwork = `supabase_network_${project}`;
  if (identity.networks.length !== 1
    || identity.networks[0] !== expectedNetwork
    || !identity.aliases.includes("db")
    || !identity.aliases.includes("db.supabase.internal")) {
    throw new Error("The local Supabase PostgreSQL container network did not match.");
  }
}

function runExecFile(file: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolvePromise, rejectPromise) => {
    execFile(file, args, { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error("The local PostgreSQL proof command failed."));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function parseJsonOutput(value: string) {
  try { return JSON.parse(value.trim()); } catch { throw new Error("The local PostgreSQL proof returned invalid JSON."); }
}

const dockerInspectionSchema = z.object({
  name: z.string(), running: z.boolean(), image: z.string(), composeProject: z.string(), supabaseProject: z.string(),
  networks: z.record(z.string(), z.object({ Aliases: z.array(z.string()).nullable() }).passthrough()),
}).strict();

async function createLocalPostgresReader(databaseContainer: string) {
  const contextName = (await runExecFile(DOCKER_BIN, ["context", "show"])).stdout.trim();
  const contextHost = z.string().parse(parseJsonOutput((await runExecFile(DOCKER_BIN, ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}", contextName])).stdout));
  validateLocalDockerContext({ contextName, host: contextHost });
  const safeInspectionFormat = '{"name":{{json .Name}},"running":{{json .State.Running}},"image":{{json .Config.Image}},"composeProject":{{json (index .Config.Labels "com.docker.compose.project")}},"supabaseProject":{{json (index .Config.Labels "com.supabase.cli.project")}},"networks":{{json .NetworkSettings.Networks}}}';
  const inspected = dockerInspectionSchema.parse(parseJsonOutput((await runExecFile(DOCKER_BIN, ["inspect", "--format", safeInspectionFormat, databaseContainer])).stdout));
  const project = databaseContainer.slice("supabase_db_".length);
  const expectedNetwork = `supabase_network_${project}`;
  validateDockerIdentity({
    name: inspected.name,
    running: inspected.running,
    image: inspected.image,
    composeProject: inspected.composeProject,
    supabaseProject: inspected.supabaseProject,
    networks: Object.keys(inspected.networks),
    aliases: inspected.networks[expectedNetwork]?.Aliases ?? [],
  }, databaseContainer);
  return {
    async readJson(query: string) {
      const response = await runExecFile(DOCKER_BIN, [
        "exec", databaseContainer, "psql", "--no-psqlrc", "--username=postgres", "--dbname=postgres",
        "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet", "--command", query,
      ]);
      return parseJsonOutput(response.stdout);
    },
  };
}

type LocalPostgresReader = Awaited<ReturnType<typeof createLocalPostgresReader>>;

async function protectedDomainSnapshot(database: LocalPostgresReader, workspaceId: string): Promise<ProtectedDomainSnapshot> {
  return parseProtectedDomainDigest(await database.readJson(buildProtectedDomainSnapshotQuery(workspaceId)));
}

async function directStoredOfficialResults(database: LocalPostgresReader, workspaceId: string, snapshotAt: string) {
  const envelope = z.object({
    readOnly: z.literal(true), officialRows: z.array(z.unknown()), observations: z.array(z.unknown()),
    runs: z.array(z.unknown()), approvals: z.array(z.unknown()), packs: z.array(z.unknown()),
  }).strict().parse(await database.readJson(buildReconciliationQuery(workspaceId)));
  return deriveExpectedOfficialResults({ ...envelope, snapshotAt });
}

export function assertLocalAuthorizationUrl(authorizationUrl: URL, supabaseUrl: URL) {
  const expected = new URL("/auth/v1/oauth/authorize", supabaseUrl);
  if (!isLoopback(authorizationUrl)
    || authorizationUrl.protocol !== "http:"
    || authorizationUrl.username !== ""
    || authorizationUrl.password !== ""
    || authorizationUrl.origin !== expected.origin
    || authorizationUrl.pathname !== expected.pathname) {
    throw new Error("OAuth authorization URL is not the exact local authorization-server endpoint.");
  }
}

export function selectProofProtocol(environment: Readonly<Record<string, string | undefined>>): typeof CURRENT_PROTOCOL | typeof LEGACY_PROTOCOL {
  const selection = environment.MCP_PROOF_PROTOCOL?.trim();
  if (selection === "current") return CURRENT_PROTOCOL;
  if (selection === "legacy") return LEGACY_PROTOCOL;
  throw new Error("MCP_PROOF_PROTOCOL must be exactly current or legacy.");
}

function proofClientOptions(protocol: typeof CURRENT_PROTOCOL | typeof LEGACY_PROTOCOL): ClientOptions {
  return protocol === CURRENT_PROTOCOL
    ? { capabilities: {}, supportedProtocolVersions: [CURRENT_PROTOCOL], versionNegotiation: { mode: { pin: CURRENT_PROTOCOL } } }
    : { capabilities: {}, supportedProtocolVersions: [LEGACY_PROTOCOL], versionNegotiation: { mode: "legacy" } };
}

export async function inspectStaticServerCallPath() {
  const [serverSource, readSource] = await Promise.all([
    readFile(resolve("src/features/mcp/server/server.ts"), "utf8"),
    readFile(resolve("src/features/mcp/application/mcp-reads.ts"), "utf8"),
  ]);
  const serverStart = serverSource.indexOf('name: "list_github_compliance_results"');
  const serverEnd = serverSource.indexOf('name: "get_latest_leadership_report"', serverStart);
  const readStart = readSource.indexOf("export async function listGitHubComplianceResults(");
  const readEnd = readSource.indexOf("export async function getLatestLeadershipReport(", readStart);
  if (serverStart < 0 || serverEnd < 0 || readStart < 0 || readEnd < 0) {
    throw new Error("Could not isolate the GitHub MCP read-only server call path for static review.");
  }
  const callPath = `${serverSource.slice(serverStart, serverEnd)}\n${readSource.slice(readStart, readEnd)}`;
  const databaseReadOnly = callPath.includes('rpc("get_mcp_github_compliance_results_v2"');
  const githubProviderReachable = /api\.github\.com|githubProvider|octokit|fetch\s*\(/i.test(callPath);
  const slackWriteReachable = /hooks\.slack\.com|slack|postDailyDigest|chat\.postMessage/i.test(callPath);
  if (!databaseReadOnly || githubProviderReachable || slackWriteReachable) {
    throw new Error("The statically reviewed GitHub MCP server path is not database-read-only.");
  }
  return {
    scope: "reviewed-source" as const,
    databaseReadOnly,
    githubProviderReachable,
    slackWriteReachable,
  };
}

async function callStructured(client: Client, name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(`MCP tool ${name} returned a safe error.`);
  return response.structuredContent;
}

function tokenAudienceMatches(token: string, endpoint: string) {
  try {
    const audience = decodeJwt(token).aud;
    return typeof audience === "string" ? audience === endpoint : Array.isArray(audience) && audience.includes(endpoint);
  } catch {
    return false;
  }
}

export async function runLivePhase3Proof(environment: NodeJS.ProcessEnv = process.env): Promise<{ proof: Phase3Proof; outputPath: string }> {
  const endpoint = environment.MCP_PROOF_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  if (endpoint !== DEFAULT_ENDPOINT) throw new Error(`Phase 3 proof endpoint must be ${DEFAULT_ENDPOINT}.`);
  const callbackPort = Number(environment.MCP_PROOF_CALLBACK_PORT || DEFAULT_CALLBACK_PORT);
  if (!Number.isInteger(callbackPort) || callbackPort < 1024 || callbackPort > 65535) throw new Error("MCP_PROOF_CALLBACK_PORT is invalid.");
  const { supabaseUrl, databaseContainer } = requireLocalPostgresSettings(environment);
  const selectedProtocol = selectProofProtocol(environment);
  const clientOptions = proofClientOptions(selectedProtocol);

  const state = randomBytes(32).toString("base64url");
  const callback = await createCallbackReceiver(callbackPort, state);
  const network = { githubCalls: 0, slackCalls: 0, nonLocalCalls: 0 };
  const proofFetch = trackedLocalFetch(network);
  let authorizationUrl: URL | undefined;
  const provider = new ProofOAuthProvider(
    callback.callbackUrl,
    {
      client_name: "ComplianceHub Phase 3 local proof",
      redirect_uris: [callback.callbackUrl.toString()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: REQUIRED_SCOPES,
    },
    state,
    (url) => { authorizationUrl = url; },
  );

  const firstTransport = new StreamableHTTPClientTransport(new URL(endpoint), { authProvider: provider, fetch: proofFetch });
  const firstClient = new Client({ name: "compliancehub-phase3-proof", version: "1.0.0" }, clientOptions);
  try {
    await firstClient.connect(firstTransport);
    throw new Error("The MCP endpoint unexpectedly allowed an unauthenticated connection.");
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
  if (!authorizationUrl) throw new Error("OAuth did not produce an authorization URL.");
  assertLocalAuthorizationUrl(authorizationUrl, new URL(supabaseUrl));
  if (authorizationUrl.searchParams.get("code_challenge_method") !== "S256") throw new Error("OAuth did not negotiate S256 PKCE.");
  if (authorizationUrl.searchParams.get("state") !== state) throw new Error("OAuth state was not bound to this proof session.");
  if (authorizationUrl.searchParams.get("redirect_uri") !== callback.callbackUrl.toString()) throw new Error("OAuth redirect URI mismatch.");
  callback.setAuthorizationUrl(authorizationUrl);
  process.stdout.write(`OAuth is ready. Open the one-time loopback handoff: ${callback.authorizationHandoffUrl.toString()}\n`);

  try {
    const authorizationCode = await callback.code;
    await firstTransport.finishAuth(authorizationCode);
  } finally {
    await callback.close();
    await firstTransport.close().catch(() => undefined);
  }

  const accessToken = provider.tokens()?.access_token;
  if (!accessToken) throw new Error("OAuth token exchange did not complete.");
  const audienceMatched = tokenAudienceMatches(accessToken, endpoint);
  if (!audienceMatched) throw new Error("OAuth access-token audience does not match the MCP resource.");

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { authProvider: provider, fetch: proofFetch });
  const client = new Client({ name: "compliancehub-phase3-proof", version: "1.0.0" }, clientOptions);
  await client.connect(transport);
  try {
    const negotiatedProtocol = client.getNegotiatedProtocolVersion();
    if (negotiatedProtocol !== selectedProtocol) throw new Error("MCP client did not negotiate the explicitly selected protocol.");
    const server = client.getServerVersion();
    if (server?.name !== "compliancehub-internal") throw new Error("Unexpected MCP server identity.");
    if (server.version !== "0.4.0") throw new Error("Unexpected MCP server version.");
    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => ({
      name: tool.name,
      readOnly: tool.annotations?.readOnlyHint,
      destructive: tool.annotations?.destructiveHint,
      openWorld: tool.annotations?.openWorldHint,
      idempotent: tool.annotations?.idempotentHint,
    }));
    if (canonicalJson(tools.map((tool) => tool.name)) !== canonicalJson(REQUIRED_TOOL_NAMES)
      || tools.some((tool) => tool.readOnly !== true || tool.destructive !== false || tool.openWorld !== false || tool.idempotent !== true)) {
      throw new Error("MCP discovery did not return the exact seven-tool read-only catalogue.");
    }
    const githubTool = listed.tools.find((tool) => tool.name === "list_github_compliance_results");
    if (!githubTool || githubTool.annotations?.readOnlyHint !== true || githubTool.annotations.destructiveHint !== false || githubTool.annotations.openWorldHint !== false) {
      throw new Error("The GitHub MCP tool is not declared as a closed-world read-only tool.");
    }
    const workspaceResult = workspaceResponseSchema.parse(await callStructured(client, "list_workspaces", {}));
    const requestedWorkspace = environment.MCP_PROOF_WORKSPACE_ID?.trim();
    const workspace = requestedWorkspace
      ? workspaceResult.data.workspaces.find((candidate) => candidate.id === requestedWorkspace)
      : workspaceResult.data.workspaces.length === 1 ? workspaceResult.data.workspaces[0] : undefined;
    if (!workspace) throw new Error("Set MCP_PROOF_WORKSPACE_ID to one accessible workspace.");

    const database = await createLocalPostgresReader(databaseContainer);
    const before = await protectedDomainSnapshot(database, workspace.id);
    const pages: Phase3Proof["githubRead"]["pages"] = [];
    const results: GitHubProofResult[] = [];
    const seenCursorHashes = new Set<string>();
    let snapshotAt: string | null = null;
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const args: Record<string, unknown> = { workspaceId: workspace.id, limit: 1 };
      if (cursor !== null) args.cursor = cursor;
      const response = githubResponseSchema.parse(await callStructured(client, "list_github_compliance_results", args));
      if (response.data.pageKind !== (page === 0 ? "initial" : "continuation")) throw new Error("MCP pagination kind was inconsistent.");
      if (snapshotAt === null) snapshotAt = response.data.snapshotAt;
      else if (response.data.snapshotAt !== snapshotAt) throw new Error("MCP pagination changed its snapshot boundary.");
      results.push(...response.data.results);
      pages.push({ pageKind: response.data.pageKind, resultCount: response.data.results.length, nextCursor: redactCursor(response.data.nextCursor) });
      cursor = response.data.nextCursor;
      if (cursor === null) break;
      const cursorHash = createHash("sha256").update(cursor, "utf8").digest("hex");
      if (seenCursorHashes.has(cursorHash)) throw new Error("MCP pagination repeated a continuation cursor.");
      seenCursorHashes.add(cursorHash);
    }
    if (cursor !== null) throw new Error("MCP pagination did not reach a null cursor within the bounded page limit.");
    if (results.length === 0) throw new Error("The local workspace has no stored official Phase 1 result to prove.");
    if (snapshotAt === null) throw new Error("The MCP read did not establish a snapshot boundary.");

    const databaseResults = await directStoredOfficialResults(database, workspace.id, snapshotAt);
    const reconciliation = reconcileOfficialResults(results, databaseResults);
    if (!reconciliation.matched) throw new Error("MCP results did not reconcile with the independent official-result table read.");
    const after = await protectedDomainSnapshot(database, workspace.id);
    const databaseUnchanged = canonicalJson(before) === canonicalJson(after);
    if (!databaseUnchanged) throw new Error("A protected domain state snapshot changed during the read proof.");
    if (network.githubCalls !== 0 || network.slackCalls !== 0 || network.nonLocalCalls !== 0) throw new Error("The local proof observed a disallowed network call.");
    const staticServerCallPath = await inspectStaticServerCallPath();

    const proof = buildPhase3Proof({
      generatedAt: new Date().toISOString(), endpoint, negotiatedProtocol,
      oauth: {
        discovery: provider.discoveryState() !== undefined,
        dynamicClientRegistration: provider.clientInformation() !== undefined,
        grant: "authorization-code", pkce: "S256", stateValidated: callback.stateWasValidated(),
        consent: "approved", audienceMatched,
      },
      server: { name: server.name, version: server.version, initialized: true },
      tools: tools as Phase3ProofTool[],
      workspaceRead: true,
      githubRead: {
        readOnly: true, destructive: false, openWorld: false, initialRequestHadCursor: false,
        limit: 1, pages, traversedToNull: cursor === null, totalResults: results.length,
      },
      databaseUnchanged: true,
      database: {
        scope: PROTECTED_STATE_SCOPE,
        before, after, unchanged: databaseUnchanged,
        reconciliation,
      },
      observations: {
        clientNetwork: {
          scope: "proof-client-process", loopbackOnly: network.nonLocalCalls === 0,
          githubCalls: network.githubCalls, slackCalls: network.slackCalls,
        },
        invokedTools: { listWorkspaces: 1, githubReadPages: pages.length, writeTools: [] },
        staticServerCallPath,
      },
      answers: createAcceptanceAnswers(results),
    });
    const outputPath = resolve(environment.MCP_PROOF_OUTPUT?.trim() || DEFAULT_OUTPUT);
    await writeProofArtifact(outputPath, proof);
    return { proof, outputPath };
  } finally {
    await transport.close().catch(() => undefined);
  }
}

async function main() {
  try {
    const { proof, outputPath } = await runLivePhase3Proof();
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      outputPath,
      negotiatedProtocol: proof.negotiatedProtocol,
      pages: proof.githubRead.pages.length,
      results: proof.githubRead.totalResults,
      databaseReconciled: proof.database.reconciliation.matched,
      clientObservedGithubCalls: proof.observations.clientNetwork.githubCalls,
      clientObservedSlackCalls: proof.observations.clientNetwork.slackCalls,
    })}\n`);
  } catch {
    process.stderr.write("Phase 3 local MCP proof did not complete. No proof artifact was accepted.\n");
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) void main();
