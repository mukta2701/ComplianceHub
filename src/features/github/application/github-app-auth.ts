import "server-only";

import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

import { throwIfGitHubRateLimited } from "./github-collection-error";
import { GITHUB_API_VERSION } from "./github-user-oauth";

type FetchLike = typeof fetch;

type GitHubInstallationTokenErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "server"
  | "network"
  | "invalid";

class GitHubInstallationTokenError extends Error {
  readonly kind: GitHubInstallationTokenErrorKind;

  constructor(kind: GitHubInstallationTokenErrorKind, message = "Could not create GitHub installation token") {
    super(message);
    this.name = "GitHubInstallationTokenError";
    this.kind = kind;
  }
}

const appConfigSchema = z.object({
  appId: z.string().trim().min(1),
  privateKey: z.string().trim().min(1),
}).strict();

const installationTokenInputSchema = z.object({
  installationId: z.number().int().positive().safe(),
  repositoryIds: z.array(z.number().int().positive().safe()).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length).optional(),
  purpose: z.enum(["collection", "inventory"]).optional(),
  appJwt: z.string().trim().min(1),
}).strict().refine((data) => data.purpose !== "inventory" || data.repositoryIds === undefined, {
  message: "Invalid GitHub installation token request",
}).refine((data) => data.purpose === "inventory" || data.repositoryIds !== undefined, {
  message: "Invalid GitHub installation token request",
});

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

export const INVENTORY_PERMISSIONS = {
  metadata: "read",
} as const;

export function hasExactReadPermissions(value: unknown): value is typeof READ_PERMISSIONS {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const expectedEntries = Object.entries(READ_PERMISSIONS).sort(([a], [b]) => a.localeCompare(b));
  const actualEntries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
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
  repositoryIds?: number[];
  purpose?: "collection" | "inventory";
  appJwt: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<{ token: string; expiresAt: string }> {
  const parsed = installationTokenInputSchema.safeParse({
    installationId: input.installationId,
    repositoryIds: input.repositoryIds,
    purpose: input.purpose,
    appJwt: input.appJwt,
  });
  if (!parsed.success) throw new Error("Invalid GitHub installation token request");

  let response: Response;
  try {
    input.signal?.throwIfAborted();
    const timeoutSignal = AbortSignal.timeout(15_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    response = await (input.fetchImpl ?? fetch)(
      `https://api.github.com/app/installations/${parsed.data.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${parsed.data.appJwt}`,
          "Content-Type": "application/json",
          "User-Agent": "ComplianceHub-GitHub-App",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        body: JSON.stringify({
          ...(parsed.data.repositoryIds !== undefined ? { repository_ids: parsed.data.repositoryIds } : {}),
          permissions: parsed.data.purpose === "inventory" ? INVENTORY_PERMISSIONS : READ_PERMISSIONS,
        }),
        cache: "no-store",
        redirect: "error",
        signal,
      },
    );
    input.signal?.throwIfAborted();
  } catch {
    throw new GitHubInstallationTokenError("network");
  }

  throwIfGitHubRateLimited(response);
  if (response.status === 401) throw new GitHubInstallationTokenError("unauthorized");
  if (response.status === 403 || response.status === 422) throw new GitHubInstallationTokenError("forbidden");
  if (response.status === 404) throw new GitHubInstallationTokenError("not_found");
  if (response.status >= 500 || !response.ok) throw new GitHubInstallationTokenError("server");

  try {
    const body = await response.json();
    input.signal?.throwIfAborted();
    const token = installationTokenResponseSchema.parse(body);
    return { token: token.token, expiresAt: token.expires_at };
  } catch {
    throw new GitHubInstallationTokenError("invalid", "GitHub returned an invalid installation token response");
  }
}
