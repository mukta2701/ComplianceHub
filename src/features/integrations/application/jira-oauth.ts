import "server-only";
import { z } from "zod";
import type { JiraProviderConfig } from "./provider-config";

export const JIRA_OAUTH_SCOPE = "read:jira-work manage:jira-webhook offline_access";
export const JIRA_WEBHOOK_EVENTS = [
  "jira:issue_created",
  "jira:issue_updated",
  "jira:issue_deleted",
] as const;

export type JiraOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
};

export type JiraAccessibleResource = {
  cloudId: string;
  name: string;
  url: string;
  scopes: string[];
};

export type JiraProject = {
  id: string;
  key: string;
  name: string;
};

export type JiraDynamicWebhook = {
  id: string;
  jqlFilter: string;
  events: Array<(typeof JIRA_WEBHOOK_EVENTS)[number]>;
  expiresAt: string;
  url: string;
};

export type JiraRefreshFailure =
  | "provider_unavailable"
  | "authorization_expired"
  | "rate_limited"
  | "configuration_error"
  | "unexpected_error";

export class JiraProviderError extends Error {
  override readonly name = "JiraProviderError";

  constructor(readonly code: JiraRefreshFailure, message: string) {
    super(message);
  }
}

export type JiraOAuthGateway = {
  exchangeAuthorizationCode(code: string): Promise<JiraOAuthTokens>;
  refreshAuthorization(refreshToken: string): Promise<JiraOAuthTokens>;
  listAccessibleResources(accessToken: string): Promise<JiraAccessibleResource[]>;
  listProjects(input: { accessToken: string; cloudId: string }): Promise<JiraProject[]>;
  listDynamicWebhooks(input: { accessToken: string; cloudId: string }): Promise<JiraDynamicWebhook[]>;
  registerDynamicWebhook(input: {
    accessToken: string;
    cloudId: string;
    callbackUrl: string;
    projectKeys: string[];
  }): Promise<{ id: string }>;
  refreshDynamicWebhook(input: {
    accessToken: string;
    cloudId: string;
    webhookId: string;
  }): Promise<{ expiresAt: string }>;
  deleteDynamicWebhook(input: {
    accessToken: string;
    cloudId: string;
    webhookId: string;
  }): Promise<void>;
};

export type JiraAccessCredential = {
  accessToken: string;
  expiresAt: string;
  generation: number;
};

export type JiraRefreshLease = JiraAccessCredential & {
  leaseId: string;
  refreshToken: string;
};

export type JiraConnectionStore = {
  saveAuthorization(input: {
    organisationId: string;
    userId: string;
    site: JiraAccessibleResource;
    tokens: JiraOAuthTokens;
  }): Promise<string>;
  savePendingAuthorization(input: {
    organisationId: string;
    userId: string;
    sites: JiraAccessibleResource[];
    tokens: JiraOAuthTokens;
  }): Promise<string>;
  finalizePendingAuthorization(input: {
    organisationId: string;
    userId: string;
    setupId: string;
    cloudId: string;
  }): Promise<string>;
  readAccessCredential(connectionId: string): Promise<JiraAccessCredential>;
  claimRefreshLease(connectionId: string): Promise<JiraRefreshLease | null>;
  completeRefreshLease(input: {
    connectionId: string;
    leaseId: string;
    tokens: JiraOAuthTokens;
  }): Promise<boolean>;
  releaseRefreshLease(input: {
    connectionId: string;
    leaseId: string;
    failure: JiraRefreshFailure;
  }): Promise<boolean>;
  disconnect(input: { organisationId: string; userId: string; connectionId: string }): Promise<void>;
};

const rawStatePattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Atlassian calls this value a cloudId, not an RFC UUID. Documented examples
// may use non-version/non-variant nibbles, while retaining the GUID shape.
const cloudIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jiraProjectIdPattern = /^[1-9][0-9]{0,39}$/;
const jiraProjectKeyPattern = /^[A-Z][A-Z0-9_]{0,79}$/;
const maxProviderBodyBytes = 2 * 1024 * 1024;
const providerRequestTimeoutMs = 15_000;
const maxProjects = 5_000;
const maxProjectPages = 100;

const credentialSchema = z.string().min(1).max(8_192).refine((value) => !/[\r\n]/.test(value));
const tokenResponseSchema = z.object({
  access_token: credentialSchema.max(4_096),
  refresh_token: credentialSchema,
  expires_in: z.number().int().min(1).max(604_800),
  scope: z.string().min(1).max(2_048).refine((value) => !/[\r\n]/.test(value)),
  token_type: z.literal("Bearer").optional(),
}).strict();

const resourceSchema = z.object({
  id: z.string().regex(cloudIdPattern),
  name: z.string().trim().min(1).max(240).refine((value) => !/[\r\n]/.test(value)),
  url: z.string().url().max(255),
  scopes: z.array(z.string().min(1).max(160).regex(/^[A-Za-z0-9:._-]+$/)).max(100),
  avatarUrl: z.string().url().max(2_048).optional(),
}).strict();
const resourcesSchema = z.array(resourceSchema).max(100);

const projectInsightSchema = z.object({
  lastIssueUpdateTime: z.string().min(1).max(100).refine((value) => !/[\r\n]/.test(value)),
  totalIssueCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
const projectCategorySchema = z.object({
  id: z.string().regex(jiraProjectIdPattern),
  name: z.string().trim().min(1).max(240).refine((value) => !/[\r\n]/.test(value)),
  description: z.string().max(5_000).refine((value) => !/[\r\n]/.test(value)).optional(),
  self: z.string().url().max(2_048).optional(),
}).strict();
const projectSchema = z.object({
  id: z.string().regex(jiraProjectIdPattern),
  key: z.string().regex(jiraProjectKeyPattern),
  name: z.string().trim().min(1).max(240).refine((value) => !/[\r\n]/.test(value)),
  expand: z.string().max(1_000).optional(),
  self: z.string().url().max(2_048).optional(),
  avatarUrls: z.record(z.string(), z.string().url().max(2_048)).optional(),
  projectTypeKey: z.string().max(100).optional(),
  simplified: z.boolean().optional(),
  style: z.string().max(100).optional(),
  isPrivate: z.boolean().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  entityId: z.string().max(255).optional(),
  uuid: z.string().max(255).optional(),
  insight: projectInsightSchema.optional(),
  projectCategory: projectCategorySchema.nullable().optional(),
}).strip();
const projectPageSchema = z.object({
  maxResults: z.number().int().min(1).max(100),
  startAt: z.number().int().min(0).max(maxProjects),
  total: z.number().int().min(0).max(maxProjects),
  isLast: z.boolean(),
  values: z.array(projectSchema).max(100),
  self: z.string().url().max(2_048).optional(),
  nextPage: z.string().url().max(2_048).optional(),
}).strict();
const dynamicWebhookSchema = z.object({
  id: z.number().int().positive().safe(),
  jqlFilter: z.string().min(1).max(10_000).refine((value) => !/[\r\n]/.test(value)),
  events: z.array(z.enum(JIRA_WEBHOOK_EVENTS)).min(1).max(JIRA_WEBHOOK_EVENTS.length),
  expirationDate: z.string().min(20).max(64).refine((value) => !/[\r\n]/.test(value)),
  url: z.string().url().max(2_048),
}).strip();
const dynamicWebhookListSchema = z.object({
  startAt: z.literal(0),
  maxResults: z.number().int().min(1).max(100),
  total: z.number().int().min(0).max(100),
  isLast: z.literal(true),
  values: z.array(dynamicWebhookSchema).max(100),
}).strip();
const dynamicWebhookRegistrationSchema = z.object({
  webhookRegistrationResult: z.array(z.object({
    createdWebhookId: z.number().int().positive().safe(),
  }).strict()).length(1),
}).strict();
const dynamicWebhookRefreshSchema = z.object({
  expirationDate: z.string().min(20).max(64).refine((value) => !/[\r\n]/.test(value)),
}).strict();

function validProviderString(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !/[\r\n]/.test(value);
}

function exactScope(scope: string): boolean {
  const granted = scope.split(/\s+/).filter(Boolean);
  const required = JIRA_OAUTH_SCOPE.split(" ");
  return granted.length === required.length
    && new Set(granted).size === required.length
    && required.every((value) => granted.includes(value))
    && !granted.includes("write:jira-work");
}

function validResourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.pathname.replace(/\/+$/, "") === ""
      && url.search === ""
      && url.hash === ""
      && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function requiredResourceScopes(scopes: string[]): boolean {
  return scopes.includes("read:jira-work")
    && scopes.includes("manage:jira-webhook")
    && !scopes.includes("write:jira-work");
}

function requireWebhookIdentity(accessToken: string, cloudId: string): void {
  if (!validProviderString(accessToken, 4_096) || !cloudIdPattern.test(cloudId)) {
    throw new Error("Jira webhook request is invalid");
  }
}

function parseWebhookId(value: string): number {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) throw new Error("Jira webhook request is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Jira webhook request is invalid");
  return parsed;
}

export function buildJiraWebhookJql(projectKeys: string[]): string {
  if (
    !Array.isArray(projectKeys)
    || projectKeys.length < 1
    || projectKeys.length > 100
    || new Set(projectKeys).size !== projectKeys.length
    || projectKeys.some((key) => !jiraProjectKeyPattern.test(key))
  ) throw new Error("Jira webhook request is invalid");
  return `project IN (${[...projectKeys].sort().map((key) => `"${key}"`).join(",")})`;
}

function jiraWebhookUrl(cloudId: string, suffix = ""): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook${suffix}`;
}

async function jiraWebhookFetch(input: {
  fetchImpl: typeof fetch;
  accessToken: string;
  cloudId: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  suffix?: string;
  body?: unknown;
  allowNotFound?: boolean;
  signal?: AbortSignal;
}): Promise<Response> {
  requireWebhookIdentity(input.accessToken, input.cloudId);
  let response: Response;
  try {
    response = await input.fetchImpl(jiraWebhookUrl(input.cloudId, input.suffix), {
      method: input.method,
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: "application/json",
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      cache: "no-store",
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(providerRequestTimeoutMs)])
        : AbortSignal.timeout(providerRequestTimeoutMs),
    });
  } catch {
    throw new JiraProviderError("provider_unavailable", "Jira is temporarily unavailable. Try again shortly.");
  }
  if (!response.ok && !(input.allowNotFound && response.status === 404)) {
    if (response.status === 429) throw new JiraProviderError("rate_limited", "Jira is rate limiting requests. Try again shortly.");
    if (response.status === 401 || response.status === 403) {
      throw new JiraProviderError("authorization_expired", "Jira access needs to be reconnected.");
    }
    if (response.status >= 500) throw new JiraProviderError("provider_unavailable", "Jira is temporarily unavailable. Try again shortly.");
    throw new JiraProviderError("unexpected_error", "Jira webhook request failed.");
  }
  return response;
}

async function readBoundedJson(response: Response, invalidMessage: string): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxProviderBodyBytes) {
    throw new Error(invalidMessage);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(invalidMessage);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxProviderBodyBytes) {
        await reader.cancel();
        throw new Error(invalidMessage);
      }
      chunks.push(value);
    }
  } catch {
    throw new Error(invalidMessage);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, totalBytes));
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(invalidMessage);
  }
}

function classifyProviderFailure(status: number, body: unknown): JiraProviderError {
  if (
    (status === 400 || status === 401 || status === 403)
    && typeof body === "object"
    && body !== null
    && !Array.isArray(body)
    && (body as Record<string, unknown>).error === "invalid_grant"
  ) return new JiraProviderError("authorization_expired", "Jira access needs to be reconnected.");
  if (status === 429) return new JiraProviderError("rate_limited", "Jira is rate limiting requests. Try again shortly.");
  if (status >= 500) return new JiraProviderError("provider_unavailable", "Jira is temporarily unavailable. Try again shortly.");
  return new JiraProviderError("unexpected_error", "Jira authorization could not be completed.");
}

async function postToken(input: {
  config: JiraProviderConfig;
  fetchImpl: typeof fetch;
  body: Record<string, string>;
  now: () => Date;
  operation: "exchange" | "refresh";
  signal?: AbortSignal;
}): Promise<JiraOAuthTokens> {
  let response: Response;
  try {
    response = await input.fetchImpl("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input.body),
      cache: "no-store",
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(providerRequestTimeoutMs)])
        : AbortSignal.timeout(providerRequestTimeoutMs),
    });
  } catch {
    throw new JiraProviderError("provider_unavailable", "Jira is temporarily unavailable. Try again shortly.");
  }
  if (!response.ok) {
    let errorBody: unknown = null;
    try {
      errorBody = await readBoundedJson(response, "Jira authorization failed");
    } catch {
      // Status classification remains safe even when the provider body is bad.
    }
    throw classifyProviderFailure(response.status, errorBody);
  }

  const invalid = input.operation === "exchange"
    ? "Jira returned an invalid authorization response"
    : "Jira returned an invalid refresh response";
  const parsed = tokenResponseSchema.safeParse(await readBoundedJson(response, invalid));
  if (!parsed.success || !exactScope(parsed.data.scope)) throw new Error(invalid);
  const now = input.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error(invalid);
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: new Date(now.getTime() + parsed.data.expires_in * 1_000).toISOString(),
    scope: JIRA_OAUTH_SCOPE,
  };
}

export function buildJiraAuthorizationUrl(config: JiraProviderConfig, state: string): string {
  if (
    !validProviderString(config.clientId, 1_024)
    || !validProviderString(config.callbackUrl, 2_048)
    || !rawStatePattern.test(state)
  ) throw new Error("Jira connection is unavailable");
  let callback: URL;
  try {
    callback = new URL(config.callbackUrl);
  } catch {
    throw new Error("Jira connection is unavailable");
  }
  const localHttp = callback.protocol === "http:"
    && callback.hostname === "localhost"
    && process.env.NODE_ENV !== "production";
  if (
    (callback.protocol !== "https:" && !localHttp)
    || (callback.protocol === "https:" && callback.port !== "")
    || callback.username !== ""
    || callback.password !== ""
    || callback.pathname !== "/api/integrations/jira/callback"
    || callback.search !== ""
    || callback.hash !== ""
  ) {
    throw new Error("Jira connection is unavailable");
  }
  const url = new URL("https://auth.atlassian.com/authorize");
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", JIRA_OAUTH_SCOPE);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export function createJiraOAuthGateway(
  config: JiraProviderConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
  signal?: AbortSignal,
): JiraOAuthGateway {
  return {
    async exchangeAuthorizationCode(code) {
      if (!validProviderString(code, 512)) throw new Error("Jira authorization code is invalid");
      return postToken({
        config,
        fetchImpl,
        now,
        operation: "exchange",
        signal,
        body: {
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.callbackUrl,
        },
      });
    },

    async refreshAuthorization(refreshToken) {
      if (!validProviderString(refreshToken, 8_192)) {
        throw new JiraProviderError("authorization_expired", "Jira access needs to be reconnected.");
      }
      return postToken({
        config,
        fetchImpl,
        now,
        operation: "refresh",
        signal,
        body: {
          grant_type: "refresh_token",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: refreshToken,
        },
      });
    },

    async listAccessibleResources(accessToken) {
      if (!validProviderString(accessToken, 4_096)) throw new Error("Jira returned invalid site metadata");
      let response: Response;
      try {
        response = await fetchImpl("https://api.atlassian.com/oauth/token/accessible-resources", {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
          cache: "no-store",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(providerRequestTimeoutMs)])
            : AbortSignal.timeout(providerRequestTimeoutMs),
        });
      } catch {
        throw new Error("Could not read accessible Jira sites");
      }
      if (!response.ok) throw new Error("Could not read accessible Jira sites");
      const parsed = resourcesSchema.safeParse(await readBoundedJson(response, "Jira returned invalid site metadata"));
      if (!parsed.success) throw new Error("Jira returned invalid site metadata");
      const sites: JiraAccessibleResource[] = [];
      const seen = new Set<string>();
      for (const resource of parsed.data) {
        if (
          seen.has(resource.id)
          || !validResourceUrl(resource.url)
          || !requiredResourceScopes(resource.scopes)
        ) throw new Error("Jira returned invalid site metadata");
        seen.add(resource.id);
        sites.push({
          cloudId: resource.id,
          name: resource.name,
          url: resource.url.replace(/\/+$/, ""),
          scopes: [...resource.scopes],
        });
      }
      return sites.sort((a, b) => a.name.localeCompare(b.name) || a.cloudId.localeCompare(b.cloudId));
    },

    async listProjects({ accessToken, cloudId }) {
      if (!validProviderString(accessToken, 4_096) || !cloudIdPattern.test(cloudId)) {
        throw new Error("Could not read Jira projects");
      }
      const projects: JiraProject[] = [];
      const seen = new Set<string>();
      let startAt = 0;
      for (let pageNumber = 0; pageNumber < maxProjectPages; pageNumber += 1) {
        const url = new URL(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search`);
        url.searchParams.set("startAt", String(startAt));
        url.searchParams.set("maxResults", "50");
        let response: Response;
        try {
          response = await fetchImpl(url.toString(), {
            method: "GET",
            headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
            cache: "no-store",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(providerRequestTimeoutMs)])
              : AbortSignal.timeout(providerRequestTimeoutMs),
          });
        } catch {
          throw new Error("Could not read Jira projects");
        }
        if (!response.ok) throw new Error("Could not read Jira projects");
        const parsed = projectPageSchema.safeParse(await readBoundedJson(response, "Jira returned invalid project metadata"));
        if (!parsed.success || parsed.data.startAt !== startAt) {
          throw new Error("Jira returned invalid project metadata");
        }
        for (const project of parsed.data.values) {
          if (seen.has(project.id)) throw new Error("Jira returned invalid project metadata");
          seen.add(project.id);
          projects.push({ id: project.id, key: project.key, name: project.name });
        }
        if (projects.length > maxProjects || projects.length > parsed.data.total) {
          throw new Error("Jira returned invalid project metadata");
        }
        if (parsed.data.isLast) {
          if (projects.length !== parsed.data.total) throw new Error("Jira returned invalid project metadata");
          return projects.sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
        }
        if (parsed.data.values.length === 0) throw new Error("Jira returned invalid project metadata");
        startAt += parsed.data.values.length;
      }
      throw new Error("Jira returned too many project pages");
    },

    async listDynamicWebhooks({ accessToken, cloudId }) {
      const response = await jiraWebhookFetch({
        fetchImpl,
        accessToken,
        cloudId,
        method: "GET",
        suffix: "?startAt=0&maxResults=100",
        signal,
      });
      const parsed = dynamicWebhookListSchema.safeParse(
        await readBoundedJson(response, "Jira returned invalid webhook metadata"),
      );
      if (!parsed.success || parsed.data.total !== parsed.data.values.length) {
        throw new Error("Jira returned invalid webhook metadata");
      }
      const seen = new Set<number>();
      return parsed.data.values.map((webhook): JiraDynamicWebhook => {
        if (seen.has(webhook.id)) throw new Error("Jira returned invalid webhook metadata");
        seen.add(webhook.id);
        const expiresAt = new Date(webhook.expirationDate);
        if (!Number.isFinite(expiresAt.getTime())) throw new Error("Jira returned invalid webhook metadata");
        return {
          id: String(webhook.id),
          jqlFilter: webhook.jqlFilter,
          events: [...webhook.events],
          expiresAt: expiresAt.toISOString(),
          url: webhook.url,
        };
      });
    },

    async registerDynamicWebhook({ accessToken, cloudId, callbackUrl, projectKeys }) {
      let callback: URL;
      let configuredCallback: URL;
      try { callback = new URL(callbackUrl); }
      catch { throw new Error("Jira webhook request is invalid"); }
      try { configuredCallback = new URL(config.callbackUrl); }
      catch { throw new Error("Jira webhook request is invalid"); }
      const localHttp = callback.protocol === "http:"
        && callback.hostname === "localhost"
        && process.env.NODE_ENV !== "production";
      if (
        (callback.protocol !== "https:" && !localHttp)
        || callback.origin !== configuredCallback.origin
        || callback.username !== ""
        || callback.password !== ""
        || callback.hash !== ""
        || callback.search !== ""
        || callbackUrl.length > 2_048
        || !/^\/api\/webhooks\/jira\/[A-Za-z0-9_-]{43}$/.test(callback.pathname)
      ) throw new Error("Jira webhook request is invalid");
      const jqlFilter = buildJiraWebhookJql(projectKeys);
      const response = await jiraWebhookFetch({
        fetchImpl,
        accessToken,
        cloudId,
        method: "POST",
        body: {
          url: callbackUrl,
          webhooks: [{ jqlFilter, events: [...JIRA_WEBHOOK_EVENTS] }],
        },
        signal,
      });
      const parsed = dynamicWebhookRegistrationSchema.safeParse(
        await readBoundedJson(response, "Jira returned invalid webhook metadata"),
      );
      if (!parsed.success) throw new Error("Jira returned invalid webhook metadata");
      return { id: String(parsed.data.webhookRegistrationResult[0].createdWebhookId) };
    },

    async refreshDynamicWebhook({ accessToken, cloudId, webhookId }) {
      const response = await jiraWebhookFetch({
        fetchImpl,
        accessToken,
        cloudId,
        method: "PUT",
        suffix: "/refresh",
        body: { webhookIds: [parseWebhookId(webhookId)] },
        signal,
      });
      const parsed = dynamicWebhookRefreshSchema.safeParse(
        await readBoundedJson(response, "Jira returned invalid webhook metadata"),
      );
      if (!parsed.success) throw new Error("Jira returned invalid webhook metadata");
      const expiresAt = new Date(parsed.data.expirationDate);
      if (!Number.isFinite(expiresAt.getTime())) throw new Error("Jira returned invalid webhook metadata");
      return { expiresAt: expiresAt.toISOString() };
    },

    async deleteDynamicWebhook({ accessToken, cloudId, webhookId }) {
      const response = await jiraWebhookFetch({
        fetchImpl,
        accessToken,
        cloudId,
        method: "DELETE",
        body: { webhookIds: [parseWebhookId(webhookId)] },
        allowNotFound: true,
        signal,
      });
      if (response.status !== 202 && response.status !== 200 && response.status !== 404) {
        throw new Error("Jira returned invalid webhook metadata");
      }
    },
  };
}

export async function completeJiraAuthorization(input: {
  gateway: JiraOAuthGateway;
  store: JiraConnectionStore;
  organisationId: string;
  userId: string;
  code: string;
}): Promise<
  | { connectionId: string; siteCount: 1; nextStep: "select_project" }
  | { setupId: string; siteCount: number; nextStep: "select_site" }
> {
  if (!uuidPattern.test(input.organisationId) || !uuidPattern.test(input.userId) || !validProviderString(input.code, 512)) {
    throw new Error("Could not complete Jira authorization");
  }
  let tokens: JiraOAuthTokens;
  let sites: JiraAccessibleResource[];
  try {
    tokens = await input.gateway.exchangeAuthorizationCode(input.code);
    sites = await input.gateway.listAccessibleResources(tokens.accessToken);
  } catch {
    throw new Error("Could not complete Jira authorization");
  }
  if (sites.length === 0) throw new Error("No accessible Jira site was found");
  sites = [...sites].sort((a, b) => a.name.localeCompare(b.name) || a.cloudId.localeCompare(b.cloudId));

  try {
    if (sites.length === 1) {
      const connectionId = await input.store.saveAuthorization({
        organisationId: input.organisationId,
        userId: input.userId,
        site: sites[0],
        tokens,
      });
      return { connectionId, siteCount: 1, nextStep: "select_project" };
    }
    const setupId = await input.store.savePendingAuthorization({
      organisationId: input.organisationId,
      userId: input.userId,
      sites,
      tokens,
    });
    return { setupId, siteCount: sites.length, nextStep: "select_site" };
  } catch {
    throw new Error("Could not save Jira authorization");
  }
}
