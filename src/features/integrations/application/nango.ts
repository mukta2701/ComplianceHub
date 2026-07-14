import "server-only";

import { z } from "zod";
import type { IntegrationProvider } from "@/features/integrations/domain/provider";
import { githubConnectionTargetSchema, jiraConnectionTargetSchema } from "./connection";

type FetchLike = typeof fetch;

const connectSessionResponseSchema = z.object({
  data: z.object({
    token: z.string().min(1).max(8_000),
    connect_link: z.string().url().max(8_000),
    expires_at: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

const publicEndUserSchema = z.object({
  id: z.string().min(1).max(255),
  display_name: z.string().max(255).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  tags: z.record(z.string(), z.string()).nullable().optional(),
  organization: z.object({
    id: z.string().min(1).max(255),
    display_name: z.string().max(255).nullable().optional(),
  }).strict().nullable().optional(),
}).strict();

const publicConnectionsResponseSchema = z.object({
  connections: z.array(z.object({
    id: z.number().int().positive(),
    connection_id: z.string().min(1).max(255),
    provider_config_key: z.string().min(1).max(255),
    created: z.string().datetime({ offset: true }),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    provider: z.string().min(1).max(100),
    errors: z.array(z.object({ type: z.string(), log_id: z.string() }).strict()),
    end_user: publicEndUserSchema.nullable().optional(),
    tags: z.record(z.string(), z.string().max(255)).refine(
      (tags) => Object.keys(tags).length <= 10,
      "Connection tags exceed the documented limit",
    ),
  }).strict()).max(100),
}).strict();

const jiraAccessibleResourcesSchema = z.array(z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  url: z.string().url().max(300),
  scopes: z.array(z.string().min(1).max(255)).max(500),
  avatarUrl: z.string().url().max(2_000).optional(),
}).strict()).max(100);

const deleteConnectionResponseSchema = z.object({ success: z.literal(true) }).strict();

const providerConfig = {
  github: { envName: "NANGO_GITHUB_INTEGRATION_ID" },
  jira: { envName: "NANGO_JIRA_INTEGRATION_ID" },
} as const;

function normaliseBaseUrl(raw: string | undefined): string {
  const url = new URL(raw?.trim() || "https://api.nango.dev");
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("NANGO_BASE_URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NANGO_BASE_URL must be an origin without credentials, path, query, or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

export function nangoProviderConfig(provider: IntegrationProvider) {
  const metadata = providerConfig[provider];
  return {
    baseUrl: normaliseBaseUrl(process.env.NANGO_BASE_URL),
    integrationId: process.env[metadata.envName]?.trim() || null,
    // Deliberately never expose the value through provider metadata. Only
    // server-side Nango requests read the secret into a request header.
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
      tags: {
        end_user_id: input.endUser.id,
        end_user_email: input.endUser.email,
        organization_id: input.organisation.id,
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
  endUserId: string;
  endUserEmail: string;
  organisationId: string;
  fetchImpl?: FetchLike;
}): Promise<void> {
  const config = serverCredentials(input.provider);
  if (!config.secretKey || !config.integrationId) {
    throw new Error("Provider setup is required before this connection can be saved");
  }
  if (input.providerConfigKey !== config.integrationId) {
    throw new Error("Provider authorization does not match this deployment");
  }

  const url = new URL("/connections", `${config.baseUrl}/`);
  url.searchParams.set("connectionId", input.connectionId);
  url.searchParams.set("tags[end_user_id]", input.endUserId);
  url.searchParams.set("tags[end_user_email]", input.endUserEmail);
  url.searchParams.set("tags[organization_id]", input.organisationId);
  const response = await (input.fetchImpl ?? fetch)(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${config.secretKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Provider authorization could not be verified");

  let parsed: z.infer<typeof publicConnectionsResponseSchema>;
  try {
    parsed = publicConnectionsResponseSchema.parse(await response.json());
  } catch {
    throw new Error("Provider authorization returned invalid connection metadata");
  }
  const exact = parsed.connections.find((connection) =>
    connection.connection_id === input.connectionId
    && connection.provider_config_key === input.providerConfigKey
    && connection.provider === input.provider
    && connection.tags.end_user_id === input.endUserId
    && connection.tags.end_user_email === input.endUserEmail
    && connection.tags.organization_id === input.organisationId
  );
  if (!exact) {
    throw new Error("Provider authorization is not bound to the active workspace operator");
  }
}

export async function nangoProxyFetch(input: {
  provider: IntegrationProvider;
  connectionId: string | null | undefined;
  providerConfigKey: string | null | undefined;
  pathSegments: readonly string[];
  query?: Record<string, string>;
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
  if (input.pathSegments.length === 0 || input.pathSegments.some((segment) =>
    segment.length === 0 || segment.length > 500 || segment === "." || segment === ".." || /[%?#\\]/.test(segment)
  )) {
    throw new Error("Invalid provider proxy path segment");
  }

  const proxyRoot = new URL("/proxy/", `${config.baseUrl}/`);
  const targetUrl = new URL(input.pathSegments.map((segment) => encodeURIComponent(segment)).join("/"), proxyRoot);
  for (const [key, value] of Object.entries(input.query ?? {})) targetUrl.searchParams.append(key, value);
  if (targetUrl.origin !== proxyRoot.origin || !targetUrl.pathname.startsWith(proxyRoot.pathname)) {
    throw new Error("Invalid provider proxy URL");
  }

  const forwarded = new Headers(input.init?.headers);
  for (const protectedHeader of [
    "authorization", "connection-id", "provider-config-key", "base-url-override",
    "host", "content-length", "transfer-encoding",
  ]) {
    forwarded.delete(protectedHeader);
  }
  const forwardedHeaders = Object.fromEntries(forwarded.entries());
  return (input.fetchImpl ?? fetch)(targetUrl.toString(), {
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

export async function verifyGitHubOAuthTarget(input: {
  connectionId: string;
  providerConfigKey: string;
  owner: string;
  repo: string;
  fetchImpl?: FetchLike;
}): Promise<void> {
  const target = githubConnectionTargetSchema.parse({ provider: "github", owner: input.owner, repo: input.repo });
  const response = await nangoProxyFetch({
    provider: "github",
    connectionId: input.connectionId,
    providerConfigKey: input.providerConfigKey,
    pathSegments: ["repos", target.owner, target.repo],
    init: { method: "GET", headers: { Accept: "application/vnd.github+json" } },
    fetchImpl: input.fetchImpl,
  });
  if (!response.ok) throw new Error("GitHub repository is not accessible through this authorization");
}

export async function resolveJiraOAuthTarget(input: {
  connectionId: string;
  providerConfigKey: string;
  baseUrl: string;
  projectKey: string;
  fetchImpl?: FetchLike;
}): Promise<{ cloudId: string }> {
  const target = jiraConnectionTargetSchema.parse({
    provider: "jira", baseUrl: input.baseUrl, projectKey: input.projectKey,
  });
  const resourcesResponse = await nangoProxyFetch({
    provider: "jira",
    connectionId: input.connectionId,
    providerConfigKey: input.providerConfigKey,
    pathSegments: ["oauth", "token", "accessible-resources"],
    init: { method: "GET", headers: { Accept: "application/json" } },
    fetchImpl: input.fetchImpl,
  });
  if (!resourcesResponse.ok) throw new Error("Jira accessible resources could not be verified");

  let resources: z.infer<typeof jiraAccessibleResourcesSchema>;
  try {
    resources = jiraAccessibleResourcesSchema.parse(await resourcesResponse.json());
  } catch {
    throw new Error("Jira accessible resources returned invalid metadata");
  }
  const submittedUrl = new URL(target.baseUrl).toString();
  const resource = resources.find((candidate) => {
    const candidateTarget = jiraConnectionTargetSchema.safeParse({
      provider: "jira", baseUrl: candidate.url, projectKey: target.projectKey,
    });
    return candidateTarget.success && new URL(candidateTarget.data.baseUrl).toString() === submittedUrl;
  });
  if (!resource) throw new Error("Jira site is not accessible through this authorization");

  const projectResponse = await nangoProxyFetch({
    provider: "jira",
    connectionId: input.connectionId,
    providerConfigKey: input.providerConfigKey,
    pathSegments: ["ex", "jira", resource.id, "rest", "api", "3", "project", target.projectKey],
    init: { method: "GET", headers: { Accept: "application/json" } },
    fetchImpl: input.fetchImpl,
  });
  if (!projectResponse.ok) throw new Error("Jira project is not accessible through this authorization");
  return { cloudId: resource.id };
}

export async function deleteNangoConnection(input: {
  provider: IntegrationProvider;
  connectionId: string;
  providerConfigKey: string;
  fetchImpl?: FetchLike;
}): Promise<void> {
  const config = serverCredentials(input.provider);
  if (!config.secretKey || !config.integrationId) {
    throw new Error("Provider setup is required before OAuth connections can be retired");
  }
  if (input.providerConfigKey !== config.integrationId) {
    throw new Error("Provider connection does not match this deployment");
  }
  const url = new URL(`/connections/${encodeURIComponent(input.connectionId)}`, `${config.baseUrl}/`);
  url.searchParams.set("provider_config_key", input.providerConfigKey);
  const response = await (input.fetchImpl ?? fetch)(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.secretKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Provider connection could not be retired");
  if (response.status === 204) return;
  try {
    deleteConnectionResponseSchema.parse(await response.json());
  } catch {
    throw new Error("Provider connection could not be retired");
  }
}
