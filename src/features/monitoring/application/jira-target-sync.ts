import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildMonitorDependencies } from "./monitor-deps";
import { runMonitoring, type MonitorSource } from "./monitor-run";
import { createJiraMonitorProvider, type JiraGetRequest } from "./jira-monitor";
import { getJiraProviderConfig } from "@/features/integrations/application/provider-config";
import { createJiraOAuthGateway } from "@/features/integrations/application/jira-oauth";
import {
  createSupabaseJiraConnectionStore,
  getFreshJiraAccessToken,
  type JiraPersistenceDatabase,
} from "@/features/integrations/application/jira-token-store";
import type { ClaimedIntegrationSyncJob } from "@/features/integrations/application/sync-jobs";

export type JiraTargetSyncDatabase = {
  from(table: string): unknown;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export type JiraTargetSyncPorts = {
  getAccessToken?: (connectionId: string, signal?: AbortSignal) => Promise<string>;
  runChecks?: (connection: {
    id: string;
    provider: "jira";
    config: Record<string, unknown>;
    accessToken: string;
    connectionMode: "jira_oauth";
  }, signal?: AbortSignal) => Promise<Awaited<ReturnType<ReturnType<typeof createJiraMonitorProvider>["runChecks"]>>>;
};

type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};

const targetConfigSchema = z.object({
  baseUrl: z.string().trim().min(1).max(300),
  cloudId: z.string().uuid(),
  projectKey: z.string().trim().min(1).max(80).regex(/^[A-Z][A-Z0-9_]*$/),
}).strict();

const targetSchema = z.object({
  id: z.uuid(),
  organisation_id: z.uuid(),
  connection_id: z.uuid(),
  provider: z.literal("jira"),
  config: z.record(z.string(), z.unknown()),
  enabled: z.literal(true),
  revoked_at: z.null(),
}).strict();

const connectionSchema = z.object({
  id: z.uuid(),
  organisation_id: z.uuid(),
  provider: z.literal("jira"),
  provider_account_id: z.string().uuid(),
  connection_mode: z.literal("jira_oauth"),
  enabled: z.literal(true),
  revoked_at: z.null(),
}).strict();

const sourceSchema = z.object({
  id: z.uuid(),
  organisation_id: z.uuid(),
  integration_connection_target_id: z.uuid(),
  provider: z.literal("jira"),
  connection_mode: z.literal("jira_oauth"),
  enabled: z.literal(true),
  revoked_at: z.null(),
}).strict();

async function readSingle(
  database: JiraTargetSyncDatabase,
  table: string,
  columns: string,
  filters: Array<[string, unknown]>,
): Promise<unknown> {
  let query = database.from(table) as unknown as Query;
  query = query.select(columns);
  for (const [column, value] of filters) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error || data === null || data === undefined) throw new Error("Jira monitor target is unavailable");
  return data;
}

async function boundedJson(response: Response): Promise<unknown> {
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 1024 * 1024) throw new Error("Jira returned an oversized monitoring response");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Jira returned invalid issue monitoring data");
  }
}

function createAtlassianRequest(input: {
  cloudId: string;
  accessToken: string;
  signal?: AbortSignal;
}): JiraGetRequest {
  return async (pathSegments, query) => {
    input.signal?.throwIfAborted();
    if (
      pathSegments.length === 0
      || pathSegments.length > 8
      || pathSegments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
    ) throw new Error("Jira monitoring path is invalid");
    const url = new URL(`https://api.atlassian.com/ex/jira/${input.cloudId}/rest/api/3/${pathSegments.join("/")}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/json" },
      cache: "no-store",
      signal: input.signal,
    });
    return { status: response.status, data: response.ok ? await boundedJson(response) : null };
  };
}

async function defaultAccessToken(
  database: JiraTargetSyncDatabase,
  connectionId: string,
  signal?: AbortSignal,
): Promise<string> {
  const config = getJiraProviderConfig();
  const gateway = createJiraOAuthGateway(config, fetch, () => new Date(), signal);
  return getFreshJiraAccessToken({
    connectionId,
    gateway,
    store: createSupabaseJiraConnectionStore(database as unknown as JiraPersistenceDatabase),
  });
}

export async function syncJiraMonitorTarget(
  database: JiraTargetSyncDatabase,
  job: Pick<ClaimedIntegrationSyncJob, "organisationId" | "connectionId" | "targetId" | "provider">,
  signal?: AbortSignal,
  ports: JiraTargetSyncPorts = {},
) {
  signal?.throwIfAborted();
  if (job.provider !== "jira" || !job.targetId) throw new Error("Jira monitor target is invalid");

  const target = targetSchema.parse(await readSingle(
    database,
    "integration_connection_targets",
    "id,organisation_id,connection_id,provider,config,enabled,revoked_at",
    [["id", job.targetId], ["organisation_id", job.organisationId]],
  ));
  if (target.connection_id !== job.connectionId) throw new Error("Jira monitor target is invalid");
  const config = targetConfigSchema.parse(target.config);
  const connection = connectionSchema.parse(await readSingle(
    database,
    "integration_connections",
    "id,organisation_id,provider,provider_account_id,connection_mode,enabled,revoked_at",
    [["id", target.connection_id], ["organisation_id", target.organisation_id]],
  ));
  if (connection.provider_account_id !== config.cloudId) throw new Error("Jira monitor target is invalid");
  const source = sourceSchema.parse(await readSingle(
    database,
    "monitor_sources",
    "id,organisation_id,integration_connection_target_id,provider,connection_mode,enabled,revoked_at",
    [["integration_connection_target_id", target.id], ["organisation_id", target.organisation_id]],
  ));

  const accessToken = await (ports.getAccessToken
    ? ports.getAccessToken(connection.id, signal)
    : defaultAccessToken(database, connection.id, signal));
  signal?.throwIfAborted();
  const monitorConnection = {
    id: source.id,
    provider: "jira" as const,
    config,
    accessToken,
    connectionMode: "jira_oauth" as const,
  };
  const dependencies = buildMonitorDependencies(
    database as unknown as SupabaseClient,
    { organisationId: target.organisation_id },
  );
  const monitorSource: MonitorSource = {
    id: source.id,
    organisationId: source.organisation_id,
    provider: "jira",
    config,
    accessToken: "",
    connectionMode: "jira_oauth",
    brokerConnectionId: null,
    brokerProviderConfigKey: null,
  };
  const runChecks = ports.runChecks ?? (async (value, activeSignal) => createJiraMonitorProvider({
    request: createAtlassianRequest({ cloudId: config.cloudId, accessToken: value.accessToken, signal: activeSignal }),
  }).runChecks(value));

  return runMonitoring({
    ...dependencies,
    listActiveSources: async () => [monitorSource],
    runChecks: async () => runChecks(monitorConnection, signal),
  });
}
