import "server-only";

import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

import { GitHubRateLimitError, throwIfGitHubRateLimited } from "./github-collection-error";

type FetchLike = typeof fetch;

const appConfigSchema = z.object({
  appId: z.string().trim().min(1),
  privateKey: z.string().trim().min(1),
}).strict();

const installationTokenInputSchema = z.object({
  installationId: z.number().int().positive().safe(),
  repositoryIds: z.array(z.number().int().positive().safe()).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length),
  appJwt: z.string().trim().min(1),
}).strict();

const installationInventoryTokenInputSchema = z.object({
  installationId: z.number().int().positive().safe(),
  appJwt: z.string().trim().min(1),
  now: z.date().refine((value) => Number.isFinite(value.getTime())),
}).strict();

const installationTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }),
}).passthrough();

export const READ_PERMISSIONS = {
  actions: "read",
  administration: "read",
  metadata: "read",
  secret_scanning_alerts: "read",
  security_events: "read",
  vulnerability_alerts: "read",
} as const;

export type GitHubInstallationTokenDiagnostic =
  | "authentication_failed"
  | "invalid_response"
  | "not_found"
  | "provider_failure"
  | "rate_limited"
  | "timeout";

export class GitHubInstallationTokenError extends Error {
  readonly retryAfterSeconds?: number;
  readonly resetAtEpochSeconds?: number;

  constructor(
    public readonly diagnosticCode: GitHubInstallationTokenDiagnostic,
    rateLimit: { retryAfterSeconds?: number; resetAtEpochSeconds?: number } = {},
  ) {
    super("GitHub installation token request failed");
    this.name = "GitHubInstallationTokenError";
    this.retryAfterSeconds = rateLimit.retryAfterSeconds;
    this.resetAtEpochSeconds = rateLimit.resetAtEpochSeconds;
  }
}

export function hasExactReadPermissions(value: unknown): value is typeof READ_PERMISSIONS {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length === Object.keys(READ_PERMISSIONS).length
    && entries.every(([name, permission]) => (
      name in READ_PERMISSIONS
      && READ_PERMISSIONS[name as keyof typeof READ_PERMISSIONS] === permission
    ));
}

export async function createAppJwt(
  config: { appId: string; privateKey: string },
  now: Date,
): Promise<string> {
  const parsed = appConfigSchema.safeParse(config);
  if (!parsed.success || !Number.isFinite(now.getTime())) {
    throw new Error("GitHub App configuration is required");
  }

  const issuedAt = Math.floor(now.getTime() / 1_000);
  const pem = parsed.data.privateKey.replace(/\\n/g, "\n");

  try {
    const privateKey = await importPKCS8(pem, "RS256");
    return await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt(issuedAt - 60)
      .setExpirationTime(issuedAt + 540)
      .setIssuer(parsed.data.appId)
      .sign(privateKey);
  } catch {
    throw new Error("Could not sign GitHub App JWT");
  }
}

export async function createInstallationToken(input: {
  installationId: number;
  repositoryIds: number[];
  appJwt: string;
  fetchImpl?: FetchLike;
}): Promise<{ token: string; expiresAt: string }> {
  const parsed = installationTokenInputSchema.safeParse({
    installationId: input.installationId,
    repositoryIds: input.repositoryIds,
    appJwt: input.appJwt,
  });
  if (!parsed.success) throw new Error("Invalid GitHub installation token request");

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      `https://api.github.com/app/installations/${parsed.data.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${parsed.data.appJwt}`,
          "Content-Type": "application/json",
          "User-Agent": "ComplianceHub-GitHub-App",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({
          repository_ids: parsed.data.repositoryIds,
          permissions: READ_PERMISSIONS,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new Error("Could not create GitHub installation token");
  }

  throwIfGitHubRateLimited(response);
  if (!response.ok) throw new Error("Could not create GitHub installation token");

  try {
    const token = installationTokenResponseSchema.parse(await response.json());
    return { token: token.token, expiresAt: token.expires_at };
  } catch {
    throw new Error("GitHub returned an invalid installation token response");
  }
}

export async function createInstallationInventoryToken(input: {
  installationId: number;
  appJwt: string;
  now: Date;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<{ token: string; expiresAt: string }> {
  const parsed = installationInventoryTokenInputSchema.safeParse({
    installationId: input.installationId,
    appJwt: input.appJwt,
    now: input.now,
  });
  if (!parsed.success) throw new Error("Invalid GitHub installation token request");

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      `https://api.github.com/app/installations/${parsed.data.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${parsed.data.appJwt}`,
          "Content-Type": "application/json",
          "User-Agent": "ComplianceHub-GitHub-App",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({ permissions: READ_PERMISSIONS }),
        cache: "no-store",
        redirect: "error",
        signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new GitHubInstallationTokenError("timeout");
    }
    throw new GitHubInstallationTokenError("provider_failure");
  }

  try {
    throwIfGitHubRateLimited(response);
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      throw new GitHubInstallationTokenError("rate_limited", {
        retryAfterSeconds: error.retryAfterSeconds,
        resetAtEpochSeconds: error.resetAtEpochSeconds,
      });
    }
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new GitHubInstallationTokenError("authentication_failed");
    }
    if (response.status === 404) throw new GitHubInstallationTokenError("not_found");
    if (response.status === 422) throw new GitHubInstallationTokenError("provider_failure");
    if (response.status >= 500) throw new GitHubInstallationTokenError("provider_failure");
    throw new GitHubInstallationTokenError("invalid_response");
  }

  try {
    const token = installationTokenResponseSchema.parse(await response.json());
    const expiresAt = Date.parse(token.expires_at);
    const now = parsed.data.now.getTime();
    if (expiresAt <= now || expiresAt > now + 60 * 60_000) throw new Error("invalid lifetime");
    return { token: token.token, expiresAt: token.expires_at };
  } catch (error) {
    if (error instanceof GitHubInstallationTokenError) throw error;
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new GitHubInstallationTokenError("timeout");
    }
    throw new GitHubInstallationTokenError("invalid_response");
  }
}
