import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/security/secrets";
import { approveSlackDestination, approveStoredSlackDestination } from "@/features/mcp/application/slack-destination-policy";
import { postSlackIncomingWebhook } from "@/lib/integrations/slack-incoming-webhook";
import { drainSlackAlertDeliveries, type ClaimedSlackAlertDelivery, type QueueSlackDeliveryInput, type SlackAlertDeliveryStore, type SlackDeliveryLeaseIdentity } from "./slack-alert-queue";

const slackLeaseIdentitySchema = z.object({
  delivery_id: z.uuid(),
  lock_token: z.uuid(),
}).strip();

const safeSlackPayloadSchema = z.object({
  type: z.enum(["monitoring_finding", "connection_health"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1).max(240),
  controlRef: z.string().min(1).max(80),
  subjectId: z.string().min(1).max(255),
  detail: z.string().min(1).max(500),
}).strict();

const claimedSlackDeliverySchema = slackLeaseIdentitySchema.extend({
  organisation_id: z.uuid(),
  channel_id: z.uuid(),
  attempt_count: z.number().int().min(1).max(5),
  safe_payload: safeSlackPayloadSchema,
}).strip();

function oneRpcRow(value: unknown, message: string): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length > 1) throw new Error(message);
  if (value.length === 0) return null;
  if (!value[0] || typeof value[0] !== "object") throw new Error(message);
  return value[0] as Record<string, unknown>;
}

export function createSupabaseSlackAlertDeliveryStore(
  database: Pick<SupabaseClient, "rpc">,
): SlackAlertDeliveryStore {
  return {
    async enqueueAndClaim(input: QueueSlackDeliveryInput, workerId: string): Promise<SlackDeliveryLeaseIdentity | null> {
      const { data, error } = await database.rpc("enqueue_and_claim_monitoring_alert_delivery", {
        target_organisation_id: input.organisationId,
        target_channel_id: input.channelId,
        target_subject_id: input.subjectId,
        safe_payload: input.payload,
        worker_id: workerId,
      });
      const row = oneRpcRow(data, "Alert delivery queue failed");
      const parsed = slackLeaseIdentitySchema.safeParse(row);
      if (error || (row !== null && !parsed.success)) throw new Error("Alert delivery queue failed");
      return row === null ? null : {
        deliveryId: parsed.data!.delivery_id,
        lockToken: parsed.data!.lock_token,
      };
    },
    async claim(workerId): Promise<ClaimedSlackAlertDelivery | null> {
      const { data, error } = await database.rpc("claim_alert_delivery", { worker_id: workerId });
      const row = oneRpcRow(data, "Alert delivery claim failed");
      const parsed = claimedSlackDeliverySchema.safeParse(row);
      if (error || (row !== null && !parsed.success)) throw new Error("Alert delivery claim failed");
      return row === null ? null : {
        deliveryId: parsed.data!.delivery_id,
        organisationId: parsed.data!.organisation_id,
        channelId: parsed.data!.channel_id,
        lockToken: parsed.data!.lock_token,
        attemptCount: parsed.data!.attempt_count,
        payload: parsed.data!.safe_payload,
      };
    },
    async complete(deliveryId, lockToken) {
      const { data, error } = await database.rpc("complete_alert_delivery", {
        target_delivery_id: deliveryId,
        claimed_lock_token: lockToken,
      });
      if (error || typeof data !== "boolean") throw new Error("Alert delivery completion failed");
      return data;
    },
    async fail(deliveryId, lockToken) {
      const { data, error } = await database.rpc("fail_alert_delivery", {
        target_delivery_id: deliveryId,
        claimed_lock_token: lockToken,
      });
      if (error || typeof data !== "boolean") throw new Error("Alert delivery failure recording failed");
      return data;
    },
  };
}

export async function drainSupabaseSlackAlertDeliveries(
  supabase: SupabaseClient,
  batchSize = 10,
  signal: AbortSignal = AbortSignal.timeout(120_000),
) {
  return drainSlackAlertDeliveries({
    store: createSupabaseSlackAlertDeliveryStore(supabase),
    workerId: `monitor-alerts:${randomUUID()}`,
    batchSize,
    signal,
    resolveWebhookUrl: async (organisationId, channelId, activeSignal) => {
      activeSignal?.throwIfAborted();
      const { data, error } = await supabase.from("alert_channels")
        .select("config")
        .eq("id", channelId).eq("organisation_id", organisationId)
        .eq("type", "slack").eq("enabled", true).is("revoked_at", null).maybeSingle();
      activeSignal?.throwIfAborted();
      const stored = error ? { status: "not_approved" as const } : approveStoredSlackDestination(data?.config);
      if (stored.status !== "approved") throw new Error("Slack alert channel is unavailable");
      const decrypted = decryptSecret(stored.encryptedWebhook);
      const approved = decrypted ? approveSlackDestination(decrypted) : { status: "not_approved" as const };
      if (approved.status !== "approved") throw new Error("Slack alert channel is unavailable");
      return approved.canonicalUrl;
    },
    postSlack: async (webhookUrl, payload, activeSignal) => {
      activeSignal?.throwIfAborted();
      const approved = approveSlackDestination(webhookUrl);
      if (approved.status !== "approved") throw new Error("Slack alert channel is unavailable");
      const result = await postSlackIncomingWebhook(approved.canonicalUrl, payload);
      if (result.kind !== "response" || result.status < 200 || result.status >= 300) {
        throw new Error("Slack alert delivery failed");
      }
    },
  });
}
