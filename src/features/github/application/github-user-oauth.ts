import "server-only";

import { createHash, createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

type FetchLike = typeof fetch;

const API_ORIGIN = "https://api.github.com";
const OAUTH_ORIGIN = "https://github.com";
const FLOW_VERSION = 1;
const FLOW_TTL_MS = 10 * 60_000;
const MAX_COOKIE_BYTES = 4_096;
const MAX_PAGES = 100;
const USER_AGENT = "ComplianceHub-GitHub-App";

const positiveId = z.number().int().positive().safe();
const flowSchema = z.object({
  v: z.literal(FLOW_VERSION),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  organisationId: z.uuid(),
  actorId: z.uuid(),
  pendingInstallationId: positiveId,
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(2_000),
  token_type: z.literal("bearer"),
  scope: z.string().max(2_000).optional(),
}).passthrough();

const installationListSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(z.object({ id: positiveId }).passthrough()).max(100),
}).passthrough();

const appInstallationSchema = z.object({
  id: positiveId,
  account: z.object({
    id: positiveId,
    login: z.string().min(1).max(100),
    type: z.enum(["Organization", "User"]),
  }).passthrough(),
  repository_selection: z.enum(["all", "selected"]),
  permissions: z.record(z.string().min(1).max(100), z.string().min(1).max(20)),
  suspended_at: z.string().datetime({ offset: true }).nullable(),
}).passthrough();

const repositorySchema = z.object({
  id: positiveId,
  owner: z.object({ login: z.string().min(1).max(100) }).passthrough(),
  name: z.string().min(1).max(100),
  full_name: z.string().min(3).max(201),
  html_url: z.string().url().max(500),
  visibility: z.enum(["public", "private", "internal"]),
  archived: z.boolean(),
  default_branch: z.string().min(1).max(255),
}).passthrough();

const repositoryListSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(repositorySchema).max(100),
}).passthrough();

export type OAuthFlowBinding = z.infer<typeof flowSchema>;

export type VerifiedAppInstallation = {
  id: number;
  account: { id: number; login: string; type: "Organization" | "User" };
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
  suspendedAt: string | null;
};

export type UserInstallationRepository = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  visibility: "public" | "private" | "internal";
  archived: boolean;
  defaultBranch: string;
};

function verificationError(): Error {
  return new Error("GitHub verification failed");
}

function macKey(clientSecret: string): Buffer {
  if (!clientSecret || clientSecret.length > 2_000) throw new Error("GitHub OAuth configuration is required");
  return createHmac("sha256", clientSecret)
    .update("compliancehub:github-oauth-flow-cookie:mac-key:v1", "utf8")
    .digest();
}

function signPayload(payload: string, clientSecret: string): string {
  return createHmac("sha256", macKey(clientSecret)).update(payload, "utf8").digest("base64url");
}

export function createOAuthFlow(input: {
  organisationId: string;
  actorId: string;
  pendingInstallationId: number;
  clientSecret: string;
  now?: Date;
  randomBytes?: () => Buffer;
}): {
  state: string;
  stateHash: string;
  codeVerifier: string;
  codeChallenge: string;
  cookieValue: string;
  expiresAt: string;
} {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid GitHub OAuth flow");
  const makeRandom = input.randomBytes ?? (() => nodeRandomBytes(32));
  const state = makeRandom().toString("base64url");
  const codeVerifier = makeRandom().toString("base64url");
  const expiresAt = new Date(now.getTime() + FLOW_TTL_MS).toISOString();
  const binding = flowSchema.parse({
    v: FLOW_VERSION,
    state,
    codeVerifier,
    organisationId: input.organisationId,
    actorId: input.actorId,
    pendingInstallationId: input.pendingInstallationId,
    expiresAt,
  });
  const payload = Buffer.from(JSON.stringify(binding), "utf8").toString("base64url");
  const cookieValue = `${payload}.${signPayload(payload, input.clientSecret)}`;
  if (Buffer.byteLength(cookieValue, "utf8") > MAX_COOKIE_BYTES) throw new Error("Invalid GitHub OAuth flow");
  return {
    state,
    stateHash: createHash("sha256").update(state, "utf8").digest("hex"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier, "ascii").digest("base64url"),
    cookieValue,
    expiresAt,
  };
}

export function parseOAuthFlowCookie(cookieValue: string, clientSecret: string, now = new Date()): OAuthFlowBinding {
  try {
    if (!cookieValue || Buffer.byteLength(cookieValue, "utf8") > MAX_COOKIE_BYTES) throw verificationError();
    const parts = cookieValue.split(".");
    if (parts.length !== 2) throw verificationError();
    const [payload = "", signature = ""] = parts;
    const expected = Buffer.from(signPayload(payload, clientSecret), "ascii");
    const actual = Buffer.from(signature, "ascii");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw verificationError();
    const parsed = flowSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!Number.isFinite(now.getTime()) || new Date(parsed.expiresAt).getTime() <= now.getTime()) throw verificationError();
    return parsed;
  } catch {
    throw new Error("Invalid GitHub OAuth flow");
  }
}

export function buildGitHubAuthorizeUrl(input: {
  clientId: string;
  callbackUrl: string;
  state: string;
  codeChallenge: string;
}): URL {
  if (!input.clientId) throw new Error("GitHub OAuth configuration is required");
  const url = new URL("/login/oauth/authorize", OAUTH_ORIGIN);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.callbackUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  url.searchParams.set("prompt", "select_account");
  return url;
}

function safeFetchInit(token: string): RequestInit {
  if (!token || token.length > 2_000) throw verificationError();
  return {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2026-03-10",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  };
}

// This boundary accepts only the allowlisted GitHub API origin checked below;
// the ephemeral authorization value is never returned, logged, or persisted.
async function fetchVerifiedGitHubApi(url: URL, authorizationValue: string, fetchImpl: FetchLike): Promise<Response> {
  if (url.origin !== API_ORIGIN || url.username || url.password || url.hash) throw verificationError();
  try {
    const response = await fetchImpl(url.toString(), safeFetchInit(authorizationValue));
    if (!response.ok) throw verificationError();
    return response;
  } catch {
    throw verificationError();
  }
}

function nextUrl(response: Response): URL | null {
  const header = response.headers.get("Link");
  if (!header) return null;
  for (const match of header.matchAll(/<([^>]*)>((?:\s*;\s*[^,]*)?)(?:,|$)/g)) {
    const parameters = match[2] ?? "";
    const relation = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i.exec(parameters);
    const relations = (relation?.[1] ?? relation?.[2] ?? "").split(/\s+/);
    if (!relations.includes("next")) continue;
    try {
      const url = new URL(match[1] ?? "");
      if (url.origin !== API_ORIGIN || url.username || url.password || url.hash) throw verificationError();
      url.searchParams.set("per_page", "100");
      return url;
    } catch {
      throw verificationError();
    }
  }
  return null;
}

export async function exchangeGitHubUserCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  callbackUrl: string;
  codeVerifier: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  if (!input.clientId || !input.clientSecret || !input.code || !input.codeVerifier) throw new Error("GitHub verification failed");
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.callbackUrl,
    code_verifier: input.codeVerifier,
  });
  try {
    const response = await (input.fetchImpl ?? fetch)(`${OAUTH_ORIGIN}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw verificationError();
    return tokenResponseSchema.parse(await response.json()).access_token;
  } catch {
    throw verificationError();
  }
}

export async function listUserInstallationIds(input: { userToken: string; fetchImpl?: FetchLike }): Promise<number[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const authorizationValue = input.userToken;
  let url = new URL("/user/installations?per_page=100", API_ORIGIN);
  const ids: number[] = [];
  let expectedCount: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetchVerifiedGitHubApi(url, authorizationValue, fetchImpl);
    let parsed: z.infer<typeof installationListSchema>;
    try { parsed = installationListSchema.parse(await response.json()); } catch { throw verificationError(); }
    expectedCount ??= parsed.total_count;
    if (parsed.total_count !== expectedCount) throw verificationError();
    ids.push(...parsed.installations.map((installation) => installation.id));
    const next = nextUrl(response);
    if (!next) {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length !== ids.length || uniqueIds.length !== expectedCount) throw verificationError();
      return uniqueIds;
    }
    if (page === MAX_PAGES - 1) throw verificationError();
    url = next;
  }
  throw verificationError();
}

export async function getAppInstallation(input: { appJwt: string; installationId: number; fetchImpl?: FetchLike }): Promise<VerifiedAppInstallation> {
  if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) throw verificationError();
  const url = new URL(`/app/installations/${input.installationId}`, API_ORIGIN);
  const response = await fetchVerifiedGitHubApi(url, input.appJwt, input.fetchImpl ?? fetch);
  try {
    const parsed = appInstallationSchema.parse(await response.json());
    return {
      id: parsed.id,
      account: parsed.account,
      repositorySelection: parsed.repository_selection,
      permissions: parsed.permissions,
      suspendedAt: parsed.suspended_at,
    };
  } catch {
    throw verificationError();
  }
}

export async function collectUserInstallationRepositories(input: { userToken: string; installationId: number; fetchImpl?: FetchLike }): Promise<UserInstallationRepository[]> {
  if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) throw verificationError();
  const url = new URL(`/user/installations/${input.installationId}/repositories?per_page=100`, API_ORIGIN);
  const authorizationValue = input.userToken;
  const response = await fetchVerifiedGitHubApi(url, authorizationValue, input.fetchImpl ?? fetch);
  let parsed: z.infer<typeof repositoryListSchema>;
  try { parsed = repositoryListSchema.parse(await response.json()); } catch { throw verificationError(); }
  if (parsed.total_count > 100 || nextUrl(response)) throw verificationError();
  const ids = new Set(parsed.repositories.map((repository) => repository.id));
  if (ids.size !== parsed.repositories.length || parsed.total_count !== parsed.repositories.length) throw verificationError();
  return parsed.repositories.map((repository) => ({
    id: repository.id,
    owner: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    htmlUrl: repository.html_url,
    visibility: repository.visibility,
    archived: repository.archived,
    defaultBranch: repository.default_branch,
  }));
}
