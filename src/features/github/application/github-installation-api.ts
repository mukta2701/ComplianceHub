import "server-only";

import { z } from "zod";

import { GitHubRateLimitError, throwIfGitHubRateLimited } from "./github-collection-error";
import {
  appInstallationSchema,
  collectPaginatedInstallationRepositories,
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
  GITHUB_USER_AGENT,
  type UserInstallationRepository,
} from "./github-user-oauth";

type FetchLike = typeof fetch;

const FETCH_TIMEOUT_MS = 15_000;

export type InstallationSnapshot = {
  installationId: number;
  account: { id: number; login: string; type: "Organization" | "User" };
  repositorySelection: "selected" | "all";
  permissions: Record<string, string>;
  suspendedAt: string | null;
  repositories: UserInstallationRepository[];
};

export type GitHubInstallationApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server"
  | "network"
  | "invalid";

export class GitHubInstallationApiError extends Error {
  readonly kind: GitHubInstallationApiErrorKind;
  readonly retryAt: string | null;

  constructor(kind: GitHubInstallationApiErrorKind, retryAt: string | null = null) {
    super("GitHub installation API failed");
    this.name = "GitHubInstallationApiError";
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

function invalid(): never {
  throw new GitHubInstallationApiError("invalid");
}

function retryAtIso(nowMs: number, error: GitHubRateLimitError): string | null {
  if (error.resetAtEpochSeconds !== undefined) {
    const resetMs = error.resetAtEpochSeconds * 1_000;
    if (Number.isFinite(resetMs)) return new Date(resetMs).toISOString();
  }
  if (error.retryAfterSeconds !== undefined) {
    return new Date(nowMs + error.retryAfterSeconds * 1_000).toISOString();
  }
  return null;
}

async function fetchInstallationApi(
  url: URL,
  token: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  if (url.origin !== GITHUB_API_ORIGIN || url.username || url.password || url.hash) invalid();
  let response: Response;
  try {
    signal?.throwIfAborted();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": GITHUB_USER_AGENT,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
    });
    signal?.throwIfAborted();
  } catch {
    throw new GitHubInstallationApiError("network");
  }
  try {
    throwIfGitHubRateLimited(response);
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      throw new GitHubInstallationApiError("rate_limited", retryAtIso(Date.now(), error));
    }
    throw new GitHubInstallationApiError("network");
  }
  if (response.status === 401) throw new GitHubInstallationApiError("unauthorized");
  if (response.status === 403) throw new GitHubInstallationApiError("forbidden");
  if (response.status === 404) throw new GitHubInstallationApiError("not_found");
  if (response.status >= 500) throw new GitHubInstallationApiError("server");
  if (!response.ok) throw new GitHubInstallationApiError("server");
  return response;
}

const tokenSchema = z.string().trim().min(1).max(2_000);

export async function readInstallationSnapshot(input: {
  installationId: number;
  appJwt: string;
  installationToken?: string;
  provideInstallationToken?: () => Promise<string>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<InstallationSnapshot> {
  if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) invalid();
  const hasInstallationToken = input.installationToken !== undefined;
  const hasInstallationTokenProvider = typeof input.provideInstallationToken === "function";
  if (!tokenSchema.safeParse(input.appJwt).success
    || (hasInstallationToken && !tokenSchema.safeParse(input.installationToken).success)
    || hasInstallationToken === hasInstallationTokenProvider) invalid();
  const timeoutMs = input.timeoutMs ?? FETCH_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) invalid();
  const fetchImpl = input.fetchImpl ?? fetch;

  const identityResponse = await fetchInstallationApi(
    new URL(`/app/installations/${input.installationId}`, GITHUB_API_ORIGIN),
    input.appJwt,
    fetchImpl,
    timeoutMs,
    input.signal,
  );
  let identity: z.infer<typeof appInstallationSchema>;
  try {
    input.signal?.throwIfAborted();
    const body = await identityResponse.json();
    input.signal?.throwIfAborted();
    identity = appInstallationSchema.parse(body);
  } catch {
    if (input.signal?.aborted) throw new GitHubInstallationApiError("network");
    invalid();
  }
  if (identity.id !== input.installationId) invalid();

  if (identity.suspended_at !== null) {
    return {
      installationId: identity.id,
      account: identity.account,
      repositorySelection: identity.repository_selection,
      permissions: identity.permissions,
      suspendedAt: identity.suspended_at,
      repositories: [],
    };
  }

  const installationToken = hasInstallationToken
    ? input.installationToken as string
    : await input.provideInstallationToken!();
  if (!tokenSchema.safeParse(installationToken).success) invalid();

  let repositories: UserInstallationRepository[];
  try {
    repositories = await collectPaginatedInstallationRepositories({
      startUrl: new URL("/installation/repositories?per_page=100", GITHUB_API_ORIGIN).toString(),
      token: installationToken,
      fetchImpl,
      signal: input.signal,
    });
  } catch {
    if (input.signal?.aborted) throw new GitHubInstallationApiError("network");
    invalid();
  }

  return {
    installationId: identity.id,
    account: identity.account,
    repositorySelection: identity.repository_selection,
    permissions: identity.permissions,
    suspendedAt: identity.suspended_at,
    repositories,
  };
}
