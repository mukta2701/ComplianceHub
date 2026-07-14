import "server-only";

import { z } from "zod";
import type { IntegrationProvider } from "@/features/integrations/domain/provider";

type FetchLike = typeof fetch;

const connectSessionResponseSchema = z.object({
  data: z.object({
    token: z.string().min(1).max(8_000),
    expires_at: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

const providerConfig = {
  github: { envName: "NANGO_GITHUB_INTEGRATION_ID", verificationPath: "user" },
  jira: { envName: "NANGO_JIRA_INTEGRATION_ID", verificationPath: "rest/api/3/myself" },
} as const;

function normaliseBaseUrl(raw: string | undefined): string {
  const url = new URL(raw?.trim() || "https://api.nango.dev");
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("NANGO_BASE_URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  return url.toString().replace(/\/$/, "");
}

export function nangoProviderConfig(provider: IntegrationProvider) {
  const metadata = providerConfig[provider];
  return {
    baseUrl: normaliseBaseUrl(process.env.NANGO_BASE_URL),
    integrationId: process.env[metadata.envName]?.trim() || null,
    verificationPath: metadata.verificationPath,
    // Deliberately never expose the value through provider metadata. Only the
    // two server-side HTTP functions below read the secret into a request header.
    secretKey: null,
  };
}

function serverCredentials(provider: IntegrationProvider) {
  const config = nangoProviderConfig(provider);
  return { ...config, secretKey: process.env.NANGO_SECRET_KEY?.trim() || null };
}

export type NangoSessionResult =
  | { configured: false }
  | { configured: true; token: string; expiresAt: string; apiBaseUrl: string };

export async function createNangoConnectSession(input: {
  provider: IntegrationProvider;
  endUser: { id: string; email: string; displayName: string };
  organisation: { id: string; displayName: string };
  fetchImpl?: FetchLike;
}): Promise<NangoSessionResult> {
  const config = serverCredentials(input.provider);
  if (!config.secretKey || !config.integrationId) return { configured: false };

  const response = await (input.fetchImpl ?? fetch)(`${config.baseUrl}/connect/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      end_user: {
        id: input.endUser.id,
        email: input.endUser.email,
        display_name: input.endUser.displayName,
      },
      organization: {
        id: input.organisation.id,
        display_name: input.organisation.displayName,
      },
      allowed_integrations: [config.integrationId],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Could not start provider authorization");

  try {
    const parsed = connectSessionResponseSchema.parse(await response.json());
    return {
      configured: true,
      token: parsed.data.token,
      expiresAt: parsed.data.expires_at,
      apiBaseUrl: config.baseUrl,
    };
  } catch {
    throw new Error("Provider authorization returned an invalid response");
  }
}

export async function verifyNangoConnection(input: {
  provider: IntegrationProvider;
  connectionId: string;
  providerConfigKey: string;
  fetchImpl?: FetchLike;
}): Promise<void> {
  const config = serverCredentials(input.provider);
  if (!config.secretKey || !config.integrationId) {
    throw new Error("Provider setup is required before this connection can be saved");
  }
  if (input.providerConfigKey !== config.integrationId) {
    throw new Error("Provider authorization does not match this deployment");
  }

  const response = await (input.fetchImpl ?? fetch)(`${config.baseUrl}/proxy/${config.verificationPath}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Connection-Id": input.connectionId,
      "Provider-Config-Key": input.providerConfigKey,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Provider authorization could not be verified");
}

export async function nangoProxyFetch(input: {
  provider: IntegrationProvider;
  connectionId: string | null | undefined;
  providerConfigKey: string | null | undefined;
  path: string;
  init?: RequestInit;
  fetchImpl?: FetchLike;
}): Promise<Response> {
  const config = serverCredentials(input.provider);
  if (!config.secretKey || !config.integrationId) {
    throw new Error("Provider setup is required before OAuth connections can be used");
  }
  if (!input.connectionId || input.providerConfigKey !== config.integrationId) {
    throw new Error("OAuth connection does not match this deployment");
  }
  if (!input.path || input.path.startsWith("/") || input.path.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(input.path)) {
    throw new Error("Invalid provider proxy path");
  }

  const forwarded = new Headers(input.init?.headers);
  for (const protectedHeader of ["authorization", "connection-id", "provider-config-key"]) {
    forwarded.delete(protectedHeader);
  }
  const forwardedHeaders = Object.fromEntries(forwarded.entries());
  return (input.fetchImpl ?? fetch)(`${config.baseUrl}/proxy/${input.path}`, {
    ...input.init,
    headers: {
      ...forwardedHeaders,
      Authorization: `Bearer ${config.secretKey}`,
      "Connection-Id": input.connectionId,
      "Provider-Config-Key": input.providerConfigKey,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}
