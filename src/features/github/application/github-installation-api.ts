import "server-only";

import { z } from "zod";

import { hasExactReadPermissions, READ_PERMISSIONS } from "./github-app-auth";
import type { UserInstallationRepository } from "./github-user-oauth";

type FetchLike = typeof fetch;

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2026-03-10";
const USER_AGENT = "ComplianceHub-GitHub-App";
const MAX_PAGES = 100;
const MAX_REPOSITORIES = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

const positiveId = z.number().int().positive().safe();
const login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/);
const repositoryName = z.string().min(1).max(100)
  .regex(/^[A-Za-z0-9_.-]+$/)
  .refine((value) => value !== "." && value !== "..");
const branchName = z.string().min(1).max(255)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const installationSchema = z.object({
  id: positiveId,
  account: z.object({
    id: positiveId,
    login,
    type: z.enum(["Organization", "User"]),
  }).passthrough(),
  repository_selection: z.enum(["all", "selected"]),
  permissions: z.record(z.string().min(1).max(100), z.string().min(1).max(20)),
  suspended_at: z.string().datetime({ offset: true }).nullable(),
}).passthrough();

const repositorySchema = z.object({
  id: positiveId,
  owner: z.object({ login }).passthrough(),
  name: repositoryName,
  full_name: z.string().min(3).max(201),
  html_url: z.string().url().max(500),
  visibility: z.enum(["public", "private", "internal"]),
  archived: z.boolean(),
  default_branch: branchName,
}).passthrough();

const repositoryPageSchema = z.object({
  total_count: z.number().int().nonnegative().max(MAX_REPOSITORIES),
  repositories: z.array(repositorySchema).max(100),
}).passthrough();

export type InstallationSnapshot = {
  installationId: number;
  account: { id: number; login: string; type: "Organization" | "User" };
  repositorySelection: "selected";
  permissions: typeof READ_PERMISSIONS;
  suspendedAt: string | null;
  repositories: UserInstallationRepository[];
};

export type GitHubInstallationApiDiagnostic =
  | "authentication_failed"
  | "not_found"
  | "rate_limited"
  | "provider_failure"
  | "timeout"
  | "invalid_response"
  | "permission_mismatch";

export class GitHubInstallationApiError extends Error {
  constructor(
    public readonly diagnosticCode: GitHubInstallationApiDiagnostic,
    public readonly retryAt: string | null = null,
  ) {
    super("GitHub installation verification failed");
    this.name = "GitHubInstallationApiError";
  }
}

function invalidResponse(): GitHubInstallationApiError {
  return new GitHubInstallationApiError("invalid_response");
}

function safeFetchInit(credential: string): RequestInit {
  if (!credential || credential.length > 2_000) throw invalidResponse();
  return {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${credential}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": API_VERSION,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function boundedInteger(value: string | null, maximum: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

function rateLimitRetryAt(response: Response): string | null {
  const now = Date.now();
  const retryAfter = boundedInteger(response.headers.get("retry-after"), 86_400);
  const maximumReset = Math.floor((now + 86_400_000) / 1_000);
  const reset = boundedInteger(response.headers.get("x-ratelimit-reset"), maximumReset);
  const candidates = [
    retryAfter === null ? null : now + retryAfter * 1_000,
    reset === null ? null : reset * 1_000,
  ].filter((value): value is number => value !== null && value >= now);
  return candidates.length === 0 ? null : new Date(Math.max(...candidates)).toISOString();
}

function responseError(response: Response): GitHubInstallationApiError {
  const rateLimited = response.status === 429
    || response.headers.has("retry-after")
    || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
  if (rateLimited) return new GitHubInstallationApiError("rate_limited", rateLimitRetryAt(response));
  if (response.status === 401 || response.status === 403) {
    return new GitHubInstallationApiError("authentication_failed");
  }
  if (response.status === 404) return new GitHubInstallationApiError("not_found");
  if (response.status >= 500) return new GitHubInstallationApiError("provider_failure");
  return invalidResponse();
}

async function request(url: URL, credential: string, fetchImpl: FetchLike): Promise<Response> {
  if (url.origin !== API_ORIGIN || url.username || url.password || url.hash) throw invalidResponse();
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), safeFetchInit(credential));
  } catch (error) {
    if (error instanceof GitHubInstallationApiError) throw error;
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new GitHubInstallationApiError("timeout");
    }
    throw new GitHubInstallationApiError("provider_failure");
  }
  if (!response.ok) throw responseError(response);
  return response;
}

async function parseJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw invalidResponse();
  }
}

function nextRepositoryUrl(response: Response, currentPage: number): URL | null {
  const header = response.headers.get("Link");
  if (!header) return null;
  for (const match of header.matchAll(/<([^>]*)>((?:\s*;\s*[^,]*)?)(?:,|$)/g)) {
    const parameters = match[2] ?? "";
    const relation = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i.exec(parameters);
    const relations = (relation?.[1] ?? relation?.[2] ?? "").split(/\s+/);
    if (!relations.includes("next")) continue;
    try {
      const url = new URL(match[1] ?? "");
      const allowedKeys = new Set(["page", "per_page"]);
      if (
        url.origin !== API_ORIGIN
        || url.username
        || url.password
        || url.hash
        || url.pathname !== "/installation/repositories"
        || [...url.searchParams.keys()].some((key) => !allowedKeys.has(key))
      ) throw invalidResponse();
      const pages = url.searchParams.getAll("page");
      const page = pages[0] ?? "";
      const numericPage = Number(page);
      if (
        pages.length !== 1
        || !/^[1-9][0-9]*$/.test(page)
        || !Number.isSafeInteger(numericPage)
        || numericPage <= currentPage
        || url.searchParams.getAll("per_page").length > 1
      ) throw invalidResponse();
      url.searchParams.set("per_page", "100");
      return url;
    } catch (error) {
      if (error instanceof GitHubInstallationApiError) throw error;
      throw invalidResponse();
    }
  }
  return null;
}

function canonicalRepository(
  value: z.infer<typeof repositorySchema>,
  accountLogin: string,
): UserInstallationRepository {
  if (value.owner.login.toLowerCase() !== accountLogin.toLowerCase()) throw invalidResponse();
  const fullName = `${value.owner.login}/${value.name}`;
  if (value.full_name !== fullName) throw invalidResponse();
  return {
    id: value.id,
    owner: value.owner.login,
    name: value.name,
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    visibility: value.visibility,
    archived: value.archived,
    defaultBranch: value.default_branch,
  };
}

export async function readInstallationSnapshot(input: {
  installationId: number;
  appJwt: string;
  installationToken: string;
  fetchImpl?: FetchLike;
}): Promise<InstallationSnapshot> {
  if (!positiveId.safeParse(input.installationId).success) throw invalidResponse();
  const fetchImpl = input.fetchImpl ?? fetch;
  const installationUrl = new URL(`/app/installations/${input.installationId}`, API_ORIGIN);
  const installationResponse = await request(installationUrl, input.appJwt, fetchImpl);
  const installation = await parseJson(installationResponse, installationSchema);
  if (installation.id !== input.installationId) throw invalidResponse();
  if (
    installation.repository_selection !== "selected"
    || !hasExactReadPermissions(installation.permissions)
  ) {
    throw new GitHubInstallationApiError("permission_mismatch");
  }

  const base = {
    installationId: installation.id,
    account: installation.account,
    repositorySelection: "selected" as const,
    permissions: READ_PERMISSIONS,
    suspendedAt: installation.suspended_at,
  };
  if (installation.suspended_at !== null) return { ...base, repositories: [] };

  const seenUrls = new Set<string>();
  const repositoryIds = new Set<number>();
  const repositoryNames = new Set<string>();
  const repositories: UserInstallationRepository[] = [];
  let expectedCount: number | null = null;
  let currentPage = 1;
  let url = new URL("/installation/repositories?per_page=100", API_ORIGIN);

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const currentUrl = url.toString();
    if (seenUrls.has(currentUrl)) throw invalidResponse();
    seenUrls.add(currentUrl);
    const response = await request(url, input.installationToken, fetchImpl);
    const parsed = await parseJson(response, repositoryPageSchema);
    expectedCount ??= parsed.total_count;
    if (parsed.total_count !== expectedCount) throw invalidResponse();

    const next = nextRepositoryUrl(response, currentPage);
    if (next && parsed.repositories.length !== 100) throw invalidResponse();
    for (const providerRepository of parsed.repositories) {
      const repository = canonicalRepository(providerRepository, installation.account.login);
      const canonicalName = repository.fullName.toLowerCase();
      if (repositoryIds.has(repository.id) || repositoryNames.has(canonicalName)) throw invalidResponse();
      repositoryIds.add(repository.id);
      repositoryNames.add(canonicalName);
      repositories.push(repository);
    }
    if (repositories.length > expectedCount || repositories.length > MAX_REPOSITORIES) throw invalidResponse();

    if (!next) {
      if (repositories.length !== expectedCount) throw invalidResponse();
      return { ...base, repositories: repositories.sort((left, right) => left.id - right.id) };
    }
    if (page === MAX_PAGES - 1 || seenUrls.has(next.toString())) throw invalidResponse();
    currentPage = Number(next.searchParams.get("page"));
    url = next;
  }
  throw invalidResponse();
}
