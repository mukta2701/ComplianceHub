import "server-only";

import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

import { throwIfGitHubRateLimited } from "./github-collection-error";

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
