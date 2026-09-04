import "server-only";
import { z } from "zod";
import type { IntegrationProvider } from "../domain/provider";

export type NativeWebhookConnection = {
  id: string;
  organisationId: string;
  provider: IntegrationProvider;
  jiraWebhookId?: string;
};

export type NativeWebhookTarget = { id: string };

export type PersistWebhookInput = {
  connection: NativeWebhookConnection;
  targetId: string | null;
  deliveryKey: string;
  eventType: string;
  deliveryPayload: Record<string, unknown>;
  payloadHash: string;
  kind: "provider_webhook" | "connection_reconciliation";
  jobPayload: Record<string, unknown>;
};

export type PersistWebhookResult = { deliveryId: string; jobId: string; created: boolean };

export type NativeWebhookStore = {
  findActiveGitHubConnection(installationId: string): Promise<NativeWebhookConnection | null>;
  findActiveJiraConnection(callbackHash: string): Promise<NativeWebhookConnection | null>;
  findActiveTarget(connection: NativeWebhookConnection, externalId: string): Promise<NativeWebhookTarget | null>;
  recordAndEnqueue(input: PersistWebhookInput): Promise<PersistWebhookResult>;
};

export type NativeWebhookDatabase = {
  from(table: string): unknown;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};

const connectionSchema = z.object({
  id: z.uuid(),
  organisation_id: z.uuid(),
  provider: z.enum(["github", "jira"]),
}).strict();
const jiraConnectionSchema = connectionSchema.extend({
  jira_webhook_id: z.string().regex(/^[1-9][0-9]{0,15}$/),
}).strict();
const targetSchema = z.object({
  id: z.uuid(),
  organisation_id: z.uuid(),
  connection_id: z.uuid(),
  provider: z.enum(["github", "jira"]),
  external_id: z.string().min(1).max(255),
}).strict();
const resultSchema = z.object({
  delivery_id: z.uuid(),
  job_id: z.uuid(),
  created: z.boolean(),
}).strict();

async function activeConnection(
  database: NativeWebhookDatabase,
  provider: IntegrationProvider,
  identityColumn: "provider_account_id" | "jira_webhook_callback_hash",
  identity: string,
): Promise<NativeWebhookConnection | null> {
  let query = database.from("integration_connections") as Query;
  query = query.select("id,organisation_id,provider")
    .eq("provider", provider)
    .eq("connection_mode", provider === "github" ? "github_app" : "jira_oauth")
    .eq(identityColumn, identity)
    .eq("enabled", true)
    .is("revoked_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Webhook connection lookup failed");
  if (!data) return null;
  const row = connectionSchema.safeParse(data);
  if (!row.success || row.data.provider !== provider) throw new Error("Webhook connection lookup failed");
  return { id: row.data.id, organisationId: row.data.organisation_id, provider };
}

export function createSupabaseNativeWebhookStore(database: NativeWebhookDatabase): NativeWebhookStore {
  return {
    findActiveGitHubConnection: (installationId) => activeConnection(
      database, "github", "provider_account_id", installationId,
    ),
    async findActiveJiraConnection(callbackHash) {
      const { data, error } = await database.rpc("resolve_active_jira_webhook_connection", {
        candidate_callback_hash: callbackHash,
      });
      if (error || !Array.isArray(data) || data.length > 1) {
        throw new Error("Webhook connection lookup failed");
      }
      if (data.length === 0) return null;
      const row = jiraConnectionSchema.safeParse(data[0]);
      if (!row.success || row.data.provider !== "jira") throw new Error("Webhook connection lookup failed");
      return {
        id: row.data.id,
        organisationId: row.data.organisation_id,
        provider: "jira",
        jiraWebhookId: row.data.jira_webhook_id,
      };
    },
    async findActiveTarget(connection, externalId) {
      let query = database.from("integration_connection_targets") as Query;
      query = query.select("id,organisation_id,connection_id,provider,external_id")
        .eq("organisation_id", connection.organisationId)
        .eq("connection_id", connection.id)
        .eq("provider", connection.provider)
        .eq("external_id", externalId)
        .eq("enabled", true)
        .is("revoked_at", null);
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error("Webhook target lookup failed");
      if (!data) return null;
      const row = targetSchema.safeParse(data);
      if (
        !row.success
        || row.data.organisation_id !== connection.organisationId
        || row.data.connection_id !== connection.id
        || row.data.provider !== connection.provider
        || row.data.external_id !== externalId
      ) throw new Error("Webhook target lookup failed");
      return { id: row.data.id };
    },
    async recordAndEnqueue(input) {
      const { data, error } = await database.rpc("record_integration_webhook_and_enqueue", {
        target_organisation_id: input.connection.organisationId,
        target_provider: input.connection.provider,
        target_connection_id: input.connection.id,
        target_id: input.targetId,
        provider_delivery_key: input.deliveryKey,
        provider_event_type: input.eventType,
        provider_payload: input.deliveryPayload,
        provider_payload_hash: input.payloadHash,
        sync_kind: input.kind,
        sync_payload: input.jobPayload,
      });
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new Error("Webhook persistence failed");
      }
      const parsed = resultSchema.safeParse(data[0]);
      if (!parsed.success) throw new Error("Webhook persistence failed");
      return {
        deliveryId: parsed.data.delivery_id,
        jobId: parsed.data.job_id,
        created: parsed.data.created,
      };
    },
  };
}
