import "server-only";

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { EXPECTED_GITHUB_CHECK_IDS, RULE_PACK_VERSION } from "../domain/rules";
import { collectRepositoryFacts } from "./collect-repository-facts";
import { buildCollectionDependencies } from "./collection-deps";
import { githubRequest } from "./github-api";
import { createAppJwt, createInstallationToken } from "./github-app-auth";
import { runGitHubCollection, type TerminalCollectionRunReference } from "./run-collection";

const GITHUB_ORIGIN = "https://api.github.com";
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;
const EXPECTED_LOCAL_TARGET = "supabase_db_compliancehub";
const PILOT_OWNER = "mukta2701";
const PILOT_REPOSITORY = "ComplianceHub";
const MAX_LEDGER_REQUESTS = 100;
const SHA256 = /^[a-f0-9]{64}$/;

export type GitHubShadowLedgerEntry = {
  method: "GET" | "POST";
  origin: typeof GITHUB_ORIGIN;
  pathTemplate: string;
  statusClass: `${1 | 2 | 3 | 4 | 5}xx`;
  count: number;
};

type ShadowScope = {
  providerInstallationId: number;
  providerRepositoryId: number;
  owner: string;
  name: string;
};

const uuidSchema = z.string().uuid();
const safeIdSchema = z.number().int().positive().safe();
const tokenMintBodySchema = z.object({
  repository_ids: z.tuple([safeIdSchema]),
  permissions: z.object({
    actions: z.literal("read"),
    administration: z.literal("read"),
    metadata: z.literal("read"),
    secret_scanning_alerts: z.literal("read"),
    security_events: z.literal("read"),
    vulnerability_alerts: z.literal("read"),
  }).strict(),
}).strict();
const selectedScopeSchema = z.object({
  organisationId: uuidSchema,
  installationId: uuidSchema,
  repositoryId: uuidSchema,
  providerInstallationId: safeIdSchema,
  providerRepositoryId: safeIdSchema,
  accountId: safeIdSchema,
  accountLogin: z.literal(PILOT_OWNER),
  accountType: z.literal("User"),
  installationStatus: z.literal("active"),
  permissionsOk: z.literal(true),
  owner: z.literal(PILOT_OWNER),
  name: z.literal(PILOT_REPOSITORY),
  selected: z.literal(true),
  available: z.literal(true),
}).strict();

const protectedGroupSchema = z.object({
  count: z.number().int().nonnegative().safe(),
  sha256: z.string().regex(SHA256),
}).strict();

const protectedStateSchema = z.object({
  materialisationJobs: protectedGroupSchema,
  officialResults: protectedGroupSchema,
  githubEvidenceProvenance: protectedGroupSchema,
  githubFindingProvenance: protectedGroupSchema,
  evidenceAndFindings: protectedGroupSchema,
  readinessSoaAssessmentRisk: protectedGroupSchema,
  githubMappingApprovalLineage: protectedGroupSchema,
  mcpDigest: protectedGroupSchema.extend({ count: z.literal(1) }),
  slackDeliveries: protectedGroupSchema,
}).strict();

const repositoryFingerprintSchema = z.object({
  identityConfigurationSha256: z.string().regex(SHA256),
  defaultBranchHeadSha256: z.string().regex(SHA256),
  safeFactsSha256: z.string().regex(SHA256),
}).strict();

const branchHeadSchema = z.object({
  ref: z.string().min(1).max(300),
  object: z.object({
    type: z.literal("commit"),
    sha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
  }).passthrough(),
}).passthrough();

const diagnosticSchema = z.enum([
  "permission_denied",
  "feature_unavailable",
  "not_found",
  "rate_limited",
  "provider_unavailable",
  "invalid_response",
]);
const outcomeObservationSchema = z.object({
  organisationId: uuidSchema,
  installationId: uuidSchema,
  repositoryId: uuidSchema,
  providerRepositoryId: safeIdSchema,
  collectionRunId: uuidSchema,
  checkId: z.enum(EXPECTED_GITHUB_CHECK_IDS),
  ruleVersion: z.literal(RULE_PACK_VERSION),
  result: z.enum(["pass", "fail", "unknown", "not_applicable"]),
  diagnosticCode: diagnosticSchema.nullable(),
  observedAt: z.string().datetime({ offset: true }),
  freshUntil: z.string().datetime({ offset: true }),
  fingerprint: z.string().regex(SHA256),
}).strict().superRefine((observation, context) => {
  if ((observation.result === "unknown") !== (observation.diagnosticCode !== null)) {
    context.addIssue({ code: "custom", message: "invalid observation diagnostic" });
  }
  if (new Date(observation.freshUntil).getTime() <= new Date(observation.observedAt).getTime()) {
    context.addIssue({ code: "custom", message: "invalid observation freshness" });
  }
});
const persistedOutcomeSchema = z.object({
  runMode: z.literal("shadow"),
  status: z.enum(["succeeded", "partial"]),
  organisationId: uuidSchema,
  installationId: uuidSchema,
  repositoryId: uuidSchema,
  providerRepositoryId: safeIdSchema,
  observationCount: z.literal(15),
  materialisationJobCount: z.literal(0),
  observations: z.array(outcomeObservationSchema).length(EXPECTED_GITHUB_CHECK_IDS.length),
}).strict().superRefine((outcome, context) => {
  const checkIds = new Set(outcome.observations.map((observation) => observation.checkId));
  if (checkIds.size !== EXPECTED_GITHUB_CHECK_IDS.length) {
    context.addIssue({ code: "custom", message: "invalid observation check set" });
  }
  const unknownCount = outcome.observations.filter((observation) => observation.result === "unknown").length;
  if ((unknownCount > 0 && outcome.status !== "partial") || (unknownCount === 0 && outcome.status !== "succeeded")) {
    context.addIssue({ code: "custom", message: "invalid outcome status" });
  }
});

const proofOutcomeSchema = z.object({
  runMode: z.literal("shadow"),
  status: z.enum(["succeeded", "partial"]),
  observationCount: z.literal(15),
  unknownCount: z.number().int().nonnegative().max(15),
  materialisationJobCount: z.literal(0),
  observationsSha256: z.string().regex(SHA256),
}).strict();

const ledgerEntrySchema = z.object({
  method: z.enum(["GET", "POST"]),
  origin: z.literal(GITHUB_ORIGIN),
  pathTemplate: z.enum([
    "/app/installations/{installation_id}/access_tokens",
    "/repos/{owner}/{repository}",
    "/repos/{owner}/{repository}/git/ref/heads/{branch}",
    "/repos/{owner}/{repository}/rules/branches/{branch}",
    "/repos/{owner}/{repository}/branches/{branch}/protection",
    "/repos/{owner}/{repository}/dependabot/alerts",
    "/repos/{owner}/{repository}/code-scanning/alerts",
    "/repos/{owner}/{repository}/secret-scanning/alerts",
    "/repos/{owner}/{repository}/actions/workflows",
    "/repos/{owner}/{repository}/actions/workflows/{workflow_id}/runs",
    "/repos/{owner}/{repository}/collaborators",
  ]),
  statusClass: z.enum(["1xx", "2xx", "3xx", "4xx", "5xx"]),
  count: z.number().int().positive().max(MAX_LEDGER_REQUESTS),
}).strict();

const proofSchema = z.object({
  schemaVersion: z.literal(1),
  targetIdentity: z.literal(EXPECTED_LOCAL_TARGET),
  runMode: z.literal("shadow"),
  runReferencesSha256: z.tuple([z.string().regex(SHA256), z.string().regex(SHA256)])
    .refine(([first, repeat]) => first !== repeat),
  repositoryFingerprint: z.object({
    before: repositoryFingerprintSchema,
    between: repositoryFingerprintSchema,
    after: repositoryFingerprintSchema,
    matched: z.literal(true),
  }).strict(),
  protectedState: z.object({
    before: protectedStateSchema,
    between: protectedStateSchema,
    after: protectedStateSchema,
    matched: z.literal(true),
  }).strict(),
  outcomes: z.tuple([proofOutcomeSchema, proofOutcomeSchema]),
  repeatability: z.object({
    matched: z.literal(true),
    stableSemanticsSha256: z.string().regex(SHA256),
  }).strict(),
  ledger: z.object({
    requestCount: z.number().int().positive().max(MAX_LEDGER_REQUESTS),
    entries: z.array(ledgerEntrySchema).min(1).max(16),
  }).strict().superRefine((ledger, context) => {
    const tokenMints = ledger.entries.filter((entry) => (
      entry.method === "POST"
      && entry.pathTemplate === "/app/installations/{installation_id}/access_tokens"
    ));
    const entryCount = ledger.entries.reduce((total, entry) => total + entry.count, 0);
    if (tokenMints.length !== 1 || tokenMints[0]?.count !== 1 || ledger.requestCount !== entryCount) {
      context.addIssue({ code: "custom", message: "invalid request ledger" });
    }
  }),
}).strict();

type SelectedScope = z.infer<typeof selectedScopeSchema>;
type ProtectedState = z.infer<typeof protectedStateSchema>;

export type ShadowProofInput = {
  service: unknown;
  allowedAccountId: number;
  appId: string;
  privateKey: string;
  approvedSecurityWorkflowIds: readonly number[];
  fetchImpl: typeof fetch;
  requestKey: string;
  proofTempRoot?: string;
  inspectLocalTarget(): Promise<string>;
  loadScope(): Promise<unknown>;
  captureProtectedState(context: { organisationId: string; localDate: string }): Promise<unknown>;
  inspectShadowOutcome(runId: string): Promise<unknown>;
};

function denied(): Error {
  return new Error("GitHub shadow proof request denied");
}

function asUrl(input: string | URL | Request): URL {
  try {
    return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  } catch {
    throw denied();
  }
}

function methodFor(input: string | URL | Request, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function decodedSegments(url: URL): string[] {
  try {
    return url.pathname.split("/").slice(1).map((segment) => decodeURIComponent(segment));
  } catch {
    throw denied();
  }
}

function hasExactQuery(url: URL, expected: Record<string, string>, paged = false): boolean {
  const allowed = new Set([...Object.keys(expected), ...(paged ? ["page"] : [])]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) return false;
  for (const [key, value] of Object.entries(expected)) {
    if (url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value) return false;
  }
  if (!paged && url.searchParams.has("page")) return false;
  if (paged && url.searchParams.has("page")) {
    const page = url.searchParams.get("page") ?? "";
    if (!/^[2-9][0-9]?$|^100$/.test(page)) return false;
  }
  return [...url.searchParams.keys()].length === Object.keys(expected).length + (url.searchParams.has("page") ? 1 : 0);
}

function getTemplate(url: URL, scope: ShadowScope): string | null {
  const segments = decodedSegments(url);
  if (
    segments.length < 3
    || segments[0] !== "repos"
    || segments[1]?.toLowerCase() !== scope.owner.toLowerCase()
    || segments[2]?.toLowerCase() !== scope.name.toLowerCase()
  ) return null;

  const suffix = segments.slice(3);
  if (suffix.length === 0 && hasExactQuery(url, {})) return "/repos/{owner}/{repository}";
  if (
    suffix.length === 4
    && suffix[0] === "git"
    && suffix[1] === "ref"
    && suffix[2] === "heads"
    && suffix[3]
    && SAFE_BRANCH.test(suffix[3])
    && hasExactQuery(url, {})
  ) return "/repos/{owner}/{repository}/git/ref/heads/{branch}";
  if (
    suffix.length === 3
    && suffix[0] === "rules"
    && suffix[1] === "branches"
    && suffix[2]
    && SAFE_BRANCH.test(suffix[2])
    && hasExactQuery(url, { per_page: "100" }, true)
  ) return "/repos/{owner}/{repository}/rules/branches/{branch}";
  if (
    suffix.length === 3
    && suffix[0] === "branches"
    && suffix[1]
    && SAFE_BRANCH.test(suffix[1])
    && suffix[2] === "protection"
    && hasExactQuery(url, {})
  ) return "/repos/{owner}/{repository}/branches/{branch}/protection";
  if (suffix.join("/") === "dependabot/alerts" && hasExactQuery(url, { state: "open", severity: "high,critical", per_page: "100" }, true)) {
    return "/repos/{owner}/{repository}/dependabot/alerts";
  }
  if (suffix.join("/") === "code-scanning/alerts") {
    const severity = url.searchParams.get("severity");
    if ((severity === "high" || severity === "critical") && hasExactQuery(url, { state: "open", severity, per_page: "100" }, true)) {
      return "/repos/{owner}/{repository}/code-scanning/alerts";
    }
  }
  if (suffix.join("/") === "secret-scanning/alerts" && hasExactQuery(url, { state: "open", per_page: "100" }, true)) {
    return "/repos/{owner}/{repository}/secret-scanning/alerts";
  }
  if (suffix.join("/") === "actions/workflows" && hasExactQuery(url, { per_page: "100" }, true)) {
    return "/repos/{owner}/{repository}/actions/workflows";
  }
  if (
    suffix.length === 4
    && suffix[0] === "actions"
    && suffix[1] === "workflows"
    && /^\d+$/.test(suffix[2] ?? "")
    && suffix[3] === "runs"
    && hasExactQuery(url, { branch: url.searchParams.get("branch") ?? "", status: "completed", per_page: "1" })
    && SAFE_BRANCH.test(url.searchParams.get("branch") ?? "")
  ) return "/repos/{owner}/{repository}/actions/workflows/{workflow_id}/runs";
  if (suffix.join("/") === "collaborators" && hasExactQuery(url, { affiliation: "outside", permission: "admin", per_page: "100" }, true)) {
    return "/repos/{owner}/{repository}/collaborators";
  }
  return null;
}

function templateFor(url: URL, method: string, scope: ShadowScope): string | null {
  if (method === "POST") {
    const exactPath = `/app/installations/${scope.providerInstallationId}/access_tokens`;
    return url.pathname === exactPath && hasExactQuery(url, {})
      ? "/app/installations/{installation_id}/access_tokens"
      : null;
  }
  return method === "GET" ? getTemplate(url, scope) : null;
}

function bodyAllowed(method: string, init: RequestInit | undefined, scope: ShadowScope): boolean {
  if (method === "GET") return init?.body === undefined || init.body === null;
  if (method !== "POST" || typeof init?.body !== "string") return false;
  try {
    const parsed = tokenMintBodySchema.safeParse(JSON.parse(init.body));
    return parsed.success && parsed.data.repository_ids[0] === scope.providerRepositoryId;
  } catch {
    return false;
  }
}

export function createGitHubShadowFetchLedger(scope: ShadowScope, providerFetch: typeof fetch) {
  if (
    !Number.isSafeInteger(scope.providerInstallationId)
    || scope.providerInstallationId <= 0
    || !Number.isSafeInteger(scope.providerRepositoryId)
    || scope.providerRepositoryId <= 0
    || !SAFE_NAME.test(scope.owner)
    || !SAFE_NAME.test(scope.name)
  ) throw denied();

  const entries: GitHubShadowLedgerEntry[] = [];
  let tokenMinted = false;
  return {
    async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
      if (entries.reduce((total, entry) => total + entry.count, 0) >= MAX_LEDGER_REQUESTS) throw denied();
      const url = asUrl(input);
      const method = methodFor(input, init);
      if (
        url.origin !== GITHUB_ORIGIN
        || url.username !== ""
        || url.password !== ""
        || url.hash !== ""
        || init?.redirect !== "error"
        || !bodyAllowed(method, init, scope)
      ) throw denied();
      const pathTemplate = templateFor(url, method, scope);
      if (!pathTemplate) throw denied();
      if (pathTemplate === "/app/installations/{installation_id}/access_tokens") {
        if (tokenMinted) throw denied();
        tokenMinted = true;
      }

      const response = await providerFetch(input, { ...init, method, redirect: "error" });
      if (response.status >= 300 && response.status < 400) throw denied();
      const statusClass = `${Math.floor(response.status / 100)}xx` as GitHubShadowLedgerEntry["statusClass"];
      const existing = entries.find((entry) => entry.method === method && entry.pathTemplate === pathTemplate && entry.statusClass === statusClass);
      if (existing) existing.count += 1;
      else entries.push({ method: method as "GET" | "POST", origin: GITHUB_ORIGIN, pathTemplate, statusClass, count: 1 });
      return response;
    },
    summary() {
      return { requestCount: entries.reduce((total, entry) => total + entry.count, 0), entries: entries.map((entry) => ({ ...entry })) };
    },
  };
}

function preconditionFailed(): Error {
  return new Error("GitHub shadow proof precondition failed");
}

function invariantFailed(): Error {
  return new Error("GitHub shadow proof invariant failed");
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalise(record[key])]));
  }
  throw invariantFailed();
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalise(value))).digest("hex");
}

function sameProtectedState(before: ProtectedState, after: ProtectedState): boolean {
  return hashCanonical(before) === hashCanonical(after);
}

function stableObservationSemantics(outcome: z.infer<typeof persistedOutcomeSchema>) {
  return outcome.observations.map((observation) => ({
    checkId: observation.checkId,
    ruleVersion: observation.ruleVersion,
    result: observation.result,
    diagnosticCode: observation.diagnosticCode,
    fingerprint: observation.fingerprint,
  })).sort((left, right) => left.checkId.localeCompare(right.checkId));
}

function londonLocalDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invariantFailed();
  return date;
}

export async function writeGitHubShadowProofFile(input: unknown, tempRoot = tmpdir()): Promise<string> {
  const parsed = proofSchema.safeParse(input);
  if (!parsed.success) throw new Error("GitHub shadow proof output denied");
  const serialised = `${JSON.stringify(parsed.data, null, 2)}\n`;
  if (/-----BEGIN|\b(?:gh[opsru]_|github_pat_|Bearer\s+|authorization|hooks\.slack\.com)\b/i.test(serialised)) {
    throw new Error("GitHub shadow proof output denied");
  }

  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(tempRoot, "compliancehub-github-shadow-proof-"));
  const proofPath = join(directory, "proof.json");
  const handle = await open(proofPath, "wx", 0o600);
  try {
    await handle.writeFile(serialised, { encoding: "utf8" });
  } finally {
    await handle.close();
  }
  return proofPath;
}

async function repositoryFactsFingerprint(
  input: ShadowProofInput,
  scope: SelectedScope,
  installationToken: string,
  fetchImpl: typeof fetch,
) {
  const facts = await collectRepositoryFacts({
    installationToken,
    repository: { repositoryId: scope.providerRepositoryId, owner: scope.owner, name: scope.name },
    approvedSecurityWorkflowIds: input.approvedSecurityWorkflowIds,
    fetchImpl,
  });
  const headResponse = await githubRequest({
    installationToken,
    pathSegments: ["repos", facts.repository.owner, facts.repository.name, "git", "ref", "heads", facts.repository.defaultBranch],
    fetchImpl,
  });
  if (!headResponse.ok) throw invariantFailed();
  const head = branchHeadSchema.safeParse(await headResponse.json().catch(() => null));
  if (!head.success || head.data.ref !== `refs/heads/${facts.repository.defaultBranch}`) throw invariantFailed();
  return {
    identityConfigurationSha256: hashCanonical(facts.repository),
    defaultBranchHeadSha256: hashCanonical({
      defaultBranch: facts.repository.defaultBranch,
      headSha: head.data.object.sha,
    }),
    safeFactsSha256: hashCanonical(facts),
  };
}

export async function runGitHubShadowProof(input: ShadowProofInput) {
  const targetIdentity = await input.inspectLocalTarget().catch(() => "");
  const scopeRows = z.array(selectedScopeSchema).safeParse(await input.loadScope().catch(() => null));
  if (
    targetIdentity !== EXPECTED_LOCAL_TARGET
    || !safeIdSchema.safeParse(input.allowedAccountId).success
    || !scopeRows.success
    || scopeRows.data.length !== 1
    || scopeRows.data[0]?.accountId !== input.allowedAccountId
  ) {
    throw preconditionFailed();
  }
  const scope = scopeRows.data[0]!;
  const protectedContext = { organisationId: scope.organisationId, localDate: londonLocalDate() };
  const beforeState = protectedStateSchema.safeParse(await input.captureProtectedState(protectedContext).catch(() => null));
  if (!beforeState.success) throw preconditionFailed();

  const ledger = createGitHubShadowFetchLedger({
    providerInstallationId: scope.providerInstallationId,
    providerRepositoryId: scope.providerRepositoryId,
    owner: scope.owner,
    name: scope.name,
  }, input.fetchImpl);
  const appJwt = await createAppJwt({ appId: input.appId, privateKey: input.privateKey }, new Date());
  const installationToken = await createInstallationToken({
    installationId: scope.providerInstallationId,
    repositoryIds: [scope.providerRepositoryId],
    appJwt,
    fetchImpl: ledger.fetch,
  });
  const beforeFingerprint = await repositoryFactsFingerprint(
    input,
    scope,
    installationToken.token,
    ledger.fetch,
  );
  const dependencies = buildCollectionDependencies(input.service, {
    appId: input.appId,
    privateKey: input.privateKey,
    approvedSecurityWorkflowIds: input.approvedSecurityWorkflowIds,
    fetchImpl: ledger.fetch,
    preloadedInstallationToken: {
      installationId: scope.installationId,
      providerInstallationId: scope.providerInstallationId,
      repositoryIds: [scope.providerRepositoryId],
      token: installationToken.token,
    },
  });
  const terminals: TerminalCollectionRunReference[] = [];
  const outcomes: Array<z.infer<typeof persistedOutcomeSchema>> = [];
  const outcomeSummaries: Array<z.infer<typeof proofOutcomeSchema>> = [];
  let betweenState: ReturnType<typeof protectedStateSchema.safeParse> | undefined;
  let betweenFingerprint: Awaited<ReturnType<typeof repositoryFactsFingerprint>> | undefined;
  for (const [index, label] of ["first", "repeat"].entries()) {
    const collection = await runGitHubCollection(dependencies, {
      trigger: "manual",
      requestKey: `${input.requestKey}:${label}`,
      runMode: "shadow",
      installationId: scope.installationId,
      repositoryId: scope.repositoryId,
    });
    if (
      collection.installationsChecked !== 1
      || collection.repositoriesChecked !== 1
      || collection.observationsStored !== 15
      || collection.repositoriesFailed !== 0
      || collection.repositoriesDeferred !== 0
      || collection.terminalRuns.length !== 1
    ) throw invariantFailed();
    const terminal = collection.terminalRuns[0]!;
    if (terminals.some((candidate) => candidate.collectionRunId === terminal.collectionRunId)) throw invariantFailed();
    terminals.push(terminal);

    const outcome = persistedOutcomeSchema.safeParse(await input.inspectShadowOutcome(terminal.collectionRunId).catch(() => null));
    if (!outcome.success) throw invariantFailed();
    const now = Date.now();
    if (
      outcome.data.organisationId !== terminal.organisationId
      || outcome.data.installationId !== terminal.installationId
      || outcome.data.repositoryId !== terminal.repositoryId
      || outcome.data.providerRepositoryId !== terminal.providerRepositoryId
      || outcome.data.observations.some((observation) => (
        observation.organisationId !== terminal.organisationId
        || observation.installationId !== terminal.installationId
        || observation.repositoryId !== terminal.repositoryId
        || observation.providerRepositoryId !== terminal.providerRepositoryId
        || observation.collectionRunId !== terminal.collectionRunId
        || new Date(observation.observedAt).getTime() < now - 5 * 60_000
        || new Date(observation.observedAt).getTime() > now + 60_000
      ))
    ) throw invariantFailed();
    outcomes.push(outcome.data);
    outcomeSummaries.push({
      runMode: outcome.data.runMode,
      status: outcome.data.status,
      observationCount: outcome.data.observationCount,
      unknownCount: outcome.data.observations.filter((observation) => observation.result === "unknown").length,
      materialisationJobCount: outcome.data.materialisationJobCount,
      observationsSha256: hashCanonical(outcome.data.observations),
    });

    if (index === 0) {
      betweenFingerprint = await repositoryFactsFingerprint(
        input,
        scope,
        installationToken.token,
        ledger.fetch,
      );
      if (hashCanonical(beforeFingerprint) !== hashCanonical(betweenFingerprint)) throw invariantFailed();
      betweenState = protectedStateSchema.safeParse(await input.captureProtectedState(protectedContext).catch(() => null));
      if (!betweenState.success || !sameProtectedState(beforeState.data, betweenState.data)) throw invariantFailed();
    }
  }

  const afterFingerprint = await repositoryFactsFingerprint(
    input,
    scope,
    installationToken.token,
    ledger.fetch,
  );
  if (
    !betweenFingerprint
    || hashCanonical(beforeFingerprint) !== hashCanonical(betweenFingerprint)
    || hashCanonical(betweenFingerprint) !== hashCanonical(afterFingerprint)
  ) throw invariantFailed();
  const afterState = protectedStateSchema.safeParse(await input.captureProtectedState(protectedContext).catch(() => null));
  if (
    !betweenState?.success
    || !afterState.success
    || !sameProtectedState(beforeState.data, betweenState.data)
    || !sameProtectedState(betweenState.data, afterState.data)
  ) throw invariantFailed();
  const stableSemantics = stableObservationSemantics(outcomes[0]!);
  if (hashCanonical(stableSemantics) !== hashCanonical(stableObservationSemantics(outcomes[1]!))) throw invariantFailed();
  const stableSemanticsSha256 = hashCanonical(stableSemantics);

  const proof = {
    schemaVersion: 1 as const,
    targetIdentity: EXPECTED_LOCAL_TARGET,
    runMode: "shadow" as const,
    runReferencesSha256: terminals.map((terminal) => hashCanonical(terminal.collectionRunId)) as [string, string],
    repositoryFingerprint: { before: beforeFingerprint, between: betweenFingerprint, after: afterFingerprint, matched: true as const },
    protectedState: { before: beforeState.data, between: betweenState.data, after: afterState.data, matched: true as const },
    outcomes: outcomeSummaries as [z.infer<typeof proofOutcomeSchema>, z.infer<typeof proofOutcomeSchema>],
    repeatability: { matched: true as const, stableSemanticsSha256 },
    ledger: ledger.summary(),
  };
  const proofPath = await writeGitHubShadowProofFile(proof, input.proofTempRoot);
  return {
    proofPath,
    summary: {
      runMode: "shadow" as const,
      runs: outcomeSummaries as [z.infer<typeof proofOutcomeSchema>, z.infer<typeof proofOutcomeSchema>],
      repeatabilityMatched: true as const,
      stableSemanticsSha256,
    },
  };
}
