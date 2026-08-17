import "server-only";

import { z } from "zod";

import { githubRequest, GitHubApiError } from "./github-api";
import type { DataState, DiagnosticCode, GitHubFactSet } from "../domain/observation";

type FetchLike = typeof fetch;

const MAX_COLLECTOR_REQUESTS = 100;
const MAX_COLLECTOR_MS = 90_000;
const MAX_PAGES = 100;
const API_ORIGIN = "https://api.github.com";
const SAFE_GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

const targetSchema = z.object({
  repositoryId: z.number().int().positive().safe(),
  owner: z.string().min(1).max(100).regex(SAFE_GITHUB_NAME),
  name: z.string().min(1).max(100).regex(SAFE_GITHUB_NAME),
}).strict();

const metadataSchema = z.object({
  id: z.number().int().positive().safe(),
  owner: z.object({ login: z.string().min(1).max(100).regex(SAFE_GITHUB_NAME) }).passthrough(),
  name: z.string().min(1).max(100).regex(SAFE_GITHUB_NAME),
  full_name: z.string().min(3).max(201),
  visibility: z.enum(["public", "private", "internal"]),
  archived: z.boolean(),
  default_branch: z.string().min(1).max(255),
  security_and_analysis: z.object({
    secret_scanning: z.object({ status: z.enum(["enabled", "disabled"]) }).passthrough().nullish(),
    secret_scanning_push_protection: z.object({ status: z.enum(["enabled", "disabled"]) }).passthrough().nullish(),
  }).passthrough().nullish(),
}).passthrough();

const ruleEnvelopeSchema = z.object({ type: z.string().min(1).max(100) }).passthrough();
const pullRequestRuleSchema = z.object({
  type: z.literal("pull_request"),
  parameters: z.object({
    required_approving_review_count: z.number().int().min(0).max(100),
    dismiss_stale_reviews_on_push: z.boolean(),
    require_code_owner_review: z.boolean(),
  }).passthrough(),
}).passthrough();
const statusChecksRuleSchema = z.object({
  type: z.literal("required_status_checks"),
  parameters: z.object({
    required_status_checks: z.array(z.object({
      context: z.string().min(1).max(255),
    }).passthrough()).max(1_000),
  }).passthrough(),
}).passthrough();

const classicProtectionSchema = z.object({
  allow_force_pushes: z.object({ enabled: z.boolean() }).passthrough().nullish(),
  allow_deletions: z.object({ enabled: z.boolean() }).passthrough().nullish(),
  required_pull_request_reviews: z.object({
    required_approving_review_count: z.number().int().min(0).max(100),
    dismiss_stale_reviews: z.boolean(),
    require_code_owner_reviews: z.boolean(),
  }).passthrough().nullish(),
  required_status_checks: z.object({
    contexts: z.array(z.string().min(1).max(255)).max(1_000).optional(),
    checks: z.array(z.object({ context: z.string().min(1).max(255) }).passthrough()).max(1_000).optional(),
  }).passthrough().nullish(),
}).passthrough();

const dependabotAlertSchema = z.object({
  number: z.number().int().positive().safe(),
  security_advisory: z.object({ severity: z.enum(["high", "critical"]) }).passthrough(),
}).passthrough();
const codeScanningAlertSchema = z.object({
  number: z.number().int().positive().safe(),
  rule: z.object({ security_severity_level: z.enum(["high", "critical"]) }).passthrough(),
}).passthrough();
const secretAlertSchema = z.object({ number: z.number().int().positive().safe() }).passthrough();
const workflowSchema = z.object({
  id: z.number().int().positive().safe(),
  name: z.string().min(1).max(255),
  state: z.string().min(1).max(100),
}).passthrough();
const workflowPageSchema = z.object({
  total_count: z.number().int().nonnegative().safe(),
  workflows: z.array(workflowSchema).max(100),
}).passthrough();
const workflowRunPageSchema = z.object({
  total_count: z.number().int().nonnegative().safe(),
  workflow_runs: z.array(z.object({
    id: z.number().int().positive().safe(),
    status: z.literal("completed"),
    conclusion: z.string().min(1).max(100).nullable(),
    head_branch: z.string().min(1).max(255).nullable(),
  }).passthrough()).max(1),
}).passthrough();
const collaboratorSchema = z.object({
  id: z.number().int().positive().safe(),
  permissions: z.object({ admin: z.boolean() }).passthrough(),
}).passthrough();

type Endpoint =
  | "metadata"
  | "rules"
  | "classic_protection"
  | "dependabot"
  | "code_scanning"
  | "secret_alerts"
  | "workflows"
  | "workflow_runs"
  | "administration";

export class GitHubCollectionError extends Error {
  constructor(public readonly diagnosticCode: DiagnosticCode) {
    super("GitHub collection failed");
    this.name = "GitHubCollectionError";
  }
}

export class GitHubRateLimitError extends GitHubCollectionError {
  readonly retryAfterSeconds?: number;
  readonly resetAtEpochSeconds?: number;

  constructor(metadata: { retryAfterSeconds?: number; resetAtEpochSeconds?: number }) {
    super("rate_limited");
    this.name = "GitHubRateLimitError";
    this.retryAfterSeconds = metadata.retryAfterSeconds;
    this.resetAtEpochSeconds = metadata.resetAtEpochSeconds;
  }
}

type RequestContext = {
  installationToken: string;
  fetchImpl: FetchLike;
  signal: AbortSignal;
  requests: number;
  maxRequests: number;
};

function boundedInteger(value: string | null, maximum: number): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : undefined;
}

function checkRateLimit(response: Response): void {
  const retryAfterPresent = response.headers.has("retry-after");
  const exhausted = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
  if (response.status !== 429 && !retryAfterPresent && !exhausted) return;

  throw new GitHubRateLimitError({
    retryAfterSeconds: boundedInteger(response.headers.get("retry-after"), 86_400),
    resetAtEpochSeconds: boundedInteger(
      response.headers.get("x-ratelimit-reset"),
      Number.MAX_SAFE_INTEGER,
    ),
  });
}

function diagnosticForEndpoint(response: Response, endpoint: Endpoint): DiagnosticCode | null {
  if (response.ok) return null;
  if (endpoint === "classic_protection" && response.status === 404) return null;
  if (endpoint === "code_scanning" && response.status === 403) return "feature_unavailable";
  if (endpoint === "secret_alerts" && response.status === 404) return "feature_unavailable";
  if (response.status === 401 || response.status === 403) return "permission_denied";
  if (response.status === 404) return "not_found";
  if (response.status >= 500) return "provider_unavailable";
  return "invalid_response";
}

async function request(context: RequestContext, input: {
  pathSegments: readonly string[];
  query?: Record<string, string>;
}): Promise<Response> {
  if (context.signal.aborted || context.requests >= context.maxRequests) {
    throw new GitHubCollectionError("provider_unavailable");
  }
  context.requests += 1;
  try {
    const response = await githubRequest({
      installationToken: context.installationToken,
      pathSegments: input.pathSegments,
      query: input.query,
      fetchImpl: context.fetchImpl,
      signal: context.signal,
    });
    checkRateLimit(response);
    return response;
  } catch (error) {
    if (error instanceof GitHubCollectionError) throw error;
    if (error instanceof GitHubApiError) {
      throw new GitHubCollectionError(error.diagnosticCode);
    }
    throw new GitHubCollectionError("provider_unavailable");
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GitHubCollectionError("invalid_response");
  }
}

function nextPage(response: Response, expectedPath: string): number | null {
  const header = response.headers.get("link");
  if (!header) return null;
  for (const match of header.matchAll(/<([^>]*)>((?:\s*;\s*[^,]*)?)(?:,|$)/g)) {
    const parameters = match[2] ?? "";
    const relation = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i.exec(parameters);
    const relations = (relation?.[1] ?? relation?.[2] ?? "").split(/\s+/);
    if (!relations.includes("next")) continue;
    try {
      const url = new URL(match[1] ?? "");
      const page = boundedInteger(url.searchParams.get("page"), MAX_PAGES + 1);
      if (url.origin !== API_ORIGIN || url.pathname !== expectedPath || !page || page < 2) {
        throw new Error("invalid");
      }
      return page;
    } catch {
      throw new GitHubCollectionError("invalid_response");
    }
  }
  return null;
}

async function listPages<T>(context: RequestContext, input: {
  pathSegments: readonly string[];
  query: Record<string, string>;
  endpoint: Endpoint;
  schema: z.ZodType<T[]>;
  maxPages: number;
}): Promise<T[]> {
  const items: T[] = [];
  const expectedPath = `/${input.pathSegments.map(encodeURIComponent).join("/")}`;
  let page: number | undefined;

  for (let pagesRead = 0; pagesRead < input.maxPages; pagesRead += 1) {
    const response = await request(context, {
      pathSegments: input.pathSegments,
      query: page ? { ...input.query, page: String(page) } : input.query,
    });
    const diagnostic = diagnosticForEndpoint(response, input.endpoint);
    if (diagnostic) throw new GitHubCollectionError(diagnostic);

    const parsed = input.schema.safeParse(await parseJson(response));
    if (!parsed.success) throw new GitHubCollectionError("invalid_response");
    items.push(...parsed.data);

    const following = nextPage(response, expectedPath);
    if (!following) return items;
    if (pagesRead === input.maxPages - 1) throw new GitHubCollectionError("invalid_response");
    page = following;
  }
  throw new GitHubCollectionError("invalid_response");
}

function unavailable<T>(diagnosticCode: DiagnosticCode): DataState<T> {
  return { state: "unavailable", diagnosticCode };
}

async function asDataState<T>(work: () => Promise<T>): Promise<DataState<T>> {
  try {
    return { state: "available", value: await work() };
  } catch (error) {
    if (error instanceof GitHubRateLimitError) throw error;
    if (error instanceof GitHubCollectionError) return unavailable(error.diagnosticCode);
    return unavailable("provider_unavailable");
  }
}

type BranchControls = GitHubFactSet["branchProtection"] extends DataState<infer T> ? T : never;

const emptyBranchControls = (): BranchControls => ({
  forcePushesBlocked: false,
  deletionsBlocked: false,
  approvingReviews: 0,
  dismissesStaleReviews: false,
  codeOwnerReviews: false,
  requiredStatusChecks: [],
});

function mergeRules(input: unknown[], classic: z.infer<typeof classicProtectionSchema> | null): BranchControls {
  const controls = emptyBranchControls();
  const checks = new Set<string>();

  if (classic) {
    controls.forcePushesBlocked = classic.allow_force_pushes?.enabled === false;
    controls.deletionsBlocked = classic.allow_deletions?.enabled === false;
    const reviews = classic.required_pull_request_reviews;
    if (reviews) {
      controls.approvingReviews = reviews.required_approving_review_count;
      controls.dismissesStaleReviews = reviews.dismiss_stale_reviews;
      controls.codeOwnerReviews = reviews.require_code_owner_reviews;
    }
    for (const context of classic.required_status_checks?.contexts ?? []) checks.add(context);
    for (const check of classic.required_status_checks?.checks ?? []) checks.add(check.context);
  }

  for (const raw of input) {
    const envelope = ruleEnvelopeSchema.safeParse(raw);
    if (!envelope.success) throw new GitHubCollectionError("invalid_response");
    if (envelope.data.type === "non_fast_forward") controls.forcePushesBlocked = true;
    else if (envelope.data.type === "deletion") controls.deletionsBlocked = true;
    else if (envelope.data.type === "pull_request") {
      const parsed = pullRequestRuleSchema.safeParse(raw);
      if (!parsed.success) throw new GitHubCollectionError("invalid_response");
      controls.approvingReviews = Math.max(
        controls.approvingReviews,
        parsed.data.parameters.required_approving_review_count,
      );
      controls.dismissesStaleReviews ||= parsed.data.parameters.dismiss_stale_reviews_on_push;
      controls.codeOwnerReviews ||= parsed.data.parameters.require_code_owner_review;
    } else if (envelope.data.type === "required_status_checks") {
      const parsed = statusChecksRuleSchema.safeParse(raw);
      if (!parsed.success) throw new GitHubCollectionError("invalid_response");
      for (const check of parsed.data.parameters.required_status_checks) checks.add(check.context);
    }
  }

  controls.requiredStatusChecks = [...checks].sort();
  return controls;
}

async function collectBranchProtection(
  context: RequestContext,
  base: readonly string[],
  defaultBranch: string,
  maxPages: number,
): Promise<BranchControls> {
  const rules = await listPages(context, {
    pathSegments: [...base, "rules", "branches", defaultBranch],
    query: { per_page: "100" },
    endpoint: "rules",
    schema: z.array(z.unknown()).max(100),
    maxPages,
  });
  const response = await request(context, {
    pathSegments: [...base, "branches", defaultBranch, "protection"],
  });
  if (response.status === 404) return mergeRules(rules, null);
  const diagnostic = diagnosticForEndpoint(response, "classic_protection");
  if (diagnostic) throw new GitHubCollectionError(diagnostic);
  const classic = classicProtectionSchema.safeParse(await parseJson(response));
  if (!classic.success) throw new GitHubCollectionError("invalid_response");
  return mergeRules(rules, classic.data);
}

function countUniqueAlerts<T extends { number: number }>(items: T[]): number {
  return new Set(items.map((item) => item.number)).size;
}

function validateWorkflowIds(ids: readonly number[]): number[] {
  if (
    ids.length > 20
    || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || new Set(ids).size !== ids.length
  ) {
    throw new Error("Invalid approved security workflow IDs");
  }
  return [...ids];
}

function archivedFacts(repository: GitHubFactSet["repository"]): GitHubFactSet {
  const notRuntime = unavailable<never>("feature_unavailable");
  return {
    repository,
    branchProtection: notRuntime,
    dependabot: notRuntime,
    codeScanning: notRuntime,
    secretScanningConfiguration: notRuntime,
    secretScanningPushProtection: notRuntime,
    secretScanningAlerts: notRuntime,
    securityWorkflows: notRuntime,
    administration: notRuntime,
  };
}

export async function collectRepositoryFacts(input: {
  installationToken: string;
  repository: { repositoryId: number; owner: string; name: string };
  approvedSecurityWorkflowIds: readonly number[];
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  maxPagesPerEndpoint?: number;
}): Promise<GitHubFactSet> {
  const selected = targetSchema.safeParse(input.repository);
  if (!selected.success || !input.installationToken) throw new Error("Invalid repository collection request");
  const approvedIds = validateWorkflowIds(input.approvedSecurityWorkflowIds);
  const maxPages = input.maxPagesPerEndpoint ?? MAX_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES) {
    throw new Error("Invalid repository collection request");
  }

  const deadlineSignal = AbortSignal.timeout(MAX_COLLECTOR_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, deadlineSignal])
    : deadlineSignal;
  const context: RequestContext = {
    installationToken: input.installationToken,
    fetchImpl: input.fetchImpl ?? fetch,
    signal,
    requests: 0,
    maxRequests: MAX_COLLECTOR_REQUESTS,
  };
  const requestedBase = ["repos", selected.data.owner, selected.data.name] as const;

  const metadataResponse = await request(context, { pathSegments: requestedBase });
  const metadataDiagnostic = diagnosticForEndpoint(metadataResponse, "metadata");
  if (metadataDiagnostic) throw new GitHubCollectionError(metadataDiagnostic);
  const metadata = metadataSchema.safeParse(await parseJson(metadataResponse));
  if (!metadata.success) throw new GitHubCollectionError("invalid_response");
  const canonicalFullName = `${metadata.data.owner.login}/${metadata.data.name}`;
  if (
    metadata.data.id !== selected.data.repositoryId
    || metadata.data.full_name !== canonicalFullName
  ) {
    throw new GitHubCollectionError("invalid_response");
  }

  const repository: GitHubFactSet["repository"] = {
    id: metadata.data.id,
    owner: metadata.data.owner.login,
    name: metadata.data.name,
    visibility: metadata.data.visibility,
    archived: metadata.data.archived,
    defaultBranch: metadata.data.default_branch,
    url: `https://github.com/${canonicalFullName}`,
  };
  if (repository.archived) return archivedFacts(repository);

  const verifiedBase = ["repos", repository.owner, repository.name] as const;
  const branchProtection = await asDataState(() =>
    collectBranchProtection(context, verifiedBase, repository.defaultBranch, maxPages));

  const dependabot = await asDataState(async () => {
    const alerts = await listPages(context, {
      pathSegments: [...verifiedBase, "dependabot", "alerts"],
      query: { state: "open", severity: "high,critical", per_page: "100" },
      endpoint: "dependabot",
      schema: z.array(dependabotAlertSchema).max(100),
      maxPages,
    });
    const unique = new Map(alerts.map((alert) => [alert.number, alert]));
    return {
      openHigh: [...unique.values()].filter((alert) => alert.security_advisory.severity === "high").length,
      openCritical: [...unique.values()].filter((alert) => alert.security_advisory.severity === "critical").length,
    };
  });

  const codeScanning = await asDataState(async () => {
    const high = await listPages(context, {
      pathSegments: [...verifiedBase, "code-scanning", "alerts"],
      query: { state: "open", severity: "high", per_page: "100" },
      endpoint: "code_scanning",
      schema: z.array(codeScanningAlertSchema).max(100),
      maxPages,
    });
    const critical = await listPages(context, {
      pathSegments: [...verifiedBase, "code-scanning", "alerts"],
      query: { state: "open", severity: "critical", per_page: "100" },
      endpoint: "code_scanning",
      schema: z.array(codeScanningAlertSchema).max(100),
      maxPages,
    });
    if (
      high.some((alert) => alert.rule.security_severity_level !== "high")
      || critical.some((alert) => alert.rule.security_severity_level !== "critical")
    ) throw new GitHubCollectionError("invalid_response");
    return { openHigh: countUniqueAlerts(high), openCritical: countUniqueAlerts(critical) };
  });

  const security = metadata.data.security_and_analysis;
  const secretScanningConfiguration: GitHubFactSet["secretScanningConfiguration"] =
    security?.secret_scanning
      ? { state: "available", value: { enabled: security.secret_scanning.status === "enabled" } }
      : unavailable("invalid_response");
  const secretScanningPushProtection: GitHubFactSet["secretScanningPushProtection"] =
    security?.secret_scanning_push_protection
      ? { state: "available", value: { enabled: security.secret_scanning_push_protection.status === "enabled" } }
      : unavailable("invalid_response");
  const secretScanningAlerts = await asDataState(async () => {
    const alerts = await listPages(context, {
      pathSegments: [...verifiedBase, "secret-scanning", "alerts"],
      query: { state: "open", per_page: "100" },
      endpoint: "secret_alerts",
      schema: z.array(secretAlertSchema).max(100),
      maxPages,
    });
    return { openAlerts: countUniqueAlerts(alerts) };
  });

  const securityWorkflows = await asDataState(async () => {
    const pathSegments = [...verifiedBase, "actions", "workflows"];
    const expectedPath = `/${pathSegments.map(encodeURIComponent).join("/")}`;
    const workflows: z.infer<typeof workflowSchema>[] = [];
    let page: number | undefined;
    let advertisedTotal = 0;
    for (let pagesRead = 0; pagesRead < maxPages; pagesRead += 1) {
      const response = await request(context, {
        pathSegments,
        query: page ? { per_page: "100", page: String(page) } : { per_page: "100" },
      });
      const diagnostic = diagnosticForEndpoint(response, "workflows");
      if (diagnostic) throw new GitHubCollectionError(diagnostic);
      const parsed = workflowPageSchema.safeParse(await parseJson(response));
      if (!parsed.success) throw new GitHubCollectionError("invalid_response");
      workflows.push(...parsed.data.workflows);
      advertisedTotal = Math.max(advertisedTotal, parsed.data.total_count);
      const following = nextPage(response, expectedPath);
      if (!following) break;
      if (pagesRead === maxPages - 1) throw new GitHubCollectionError("invalid_response");
      page = following;
    }
    const uniqueWorkflows = new Map<number, z.infer<typeof workflowSchema>>();
    for (const workflow of workflows) uniqueWorkflows.set(workflow.id, workflow);
    if (uniqueWorkflows.size < advertisedTotal) throw new GitHubCollectionError("invalid_response");

    const approved = [...uniqueWorkflows.values()].filter((workflow) => approvedIds.includes(workflow.id));
    const results = [];
    for (const workflow of approved) {
      const response = await request(context, {
        pathSegments: [...verifiedBase, "actions", "workflows", String(workflow.id), "runs"],
        query: { branch: repository.defaultBranch, status: "completed", per_page: "1" },
      });
      const diagnostic = diagnosticForEndpoint(response, "workflow_runs");
      if (diagnostic) throw new GitHubCollectionError(diagnostic);
      const parsed = workflowRunPageSchema.safeParse(await parseJson(response));
      if (!parsed.success) throw new GitHubCollectionError("invalid_response");
      const latest = parsed.data.workflow_runs[0];
      if (latest && latest.head_branch !== repository.defaultBranch) {
        throw new GitHubCollectionError("invalid_response");
      }
      results.push({
        name: workflow.name,
        approved: true,
        active: workflow.state === "active",
        latestConclusion: latest?.conclusion ?? null,
      });
    }
    return results;
  });

  const administration = await asDataState(async () => {
    const collaborators = await listPages(context, {
      pathSegments: [...verifiedBase, "collaborators"],
      query: { affiliation: "outside", permission: "admin", per_page: "100" },
      endpoint: "administration",
      schema: z.array(collaboratorSchema).max(100),
      maxPages,
    });
    return {
      outsideCollaboratorAdmins: new Set(
        collaborators.filter((collaborator) => collaborator.permissions.admin).map((collaborator) => collaborator.id),
      ).size,
    };
  });

  return {
    repository,
    branchProtection,
    dependabot,
    codeScanning,
    secretScanningConfiguration,
    secretScanningPushProtection,
    secretScanningAlerts,
    securityWorkflows,
    administration,
  };
}
