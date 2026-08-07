import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { decryptSecret } from "@/lib/security/secrets";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { McpError, type McpErrorCode } from "../auth/errors";
import {
  buildSlackDigestPayload,
  dailyDigestMessageSchema,
  validateDigestMessageAgainstFacts,
} from "../domain/digest";
import { prepareDailyDigest, type PrepareDailyDigestResult } from "./mcp-reads";
import { resolveWorkspace, type AccessibleWorkspace } from "./workspace-access";

const uuid = z.uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const factHash = z.string().regex(/^[0-9a-f]{64}$/);
const slackPayloadSchema = z.object({
  text: z.string().min(1).max(500),
  blocks: z.array(z.unknown()).min(1).max(10),
}).strict();

export const postDailyDigestInputSchema = dailyDigestMessageSchema.extend({
  workspaceId: uuid.optional(),
  localDate,
  factHash,
}).strict();

export type PostDailyDigestInput = z.infer<typeof postDailyDigestInputSchema>;
export type SlackDigestPayload = { readonly text: string; readonly blocks: readonly unknown[] };
export type SlackDeliveryOutcome =
  | { outcome: "delivered" }
  | { outcome: "failed"; errorCode: "SLACK_REJECTED" | "RATE_LIMITED" }
  | { outcome: "unknown"; errorCode: "DELIVERY_UNKNOWN" };

export type DigestReservation =
  | { state: "no_digest_channel" | "already_posted" | "delivery_unknown" }
  | {
    state: "reserved";
    deliveryId: string;
    channelId: string;
    attemptNumber: number;
    message: SlackDigestPayload;
  };

type ReserveInput = {
  workspaceId: string;
  localDate: string;
  factHash: string;
  message: SlackDigestPayload;
};

type FinalizeInput = {
  deliveryId: string;
  attemptNumber: number;
  outcome: SlackDeliveryOutcome["outcome"];
  errorCode?: "SLACK_REJECTED" | "RATE_LIMITED" | "DELIVERY_UNKNOWN";
};

export type PostDailyDigestDependencies = {
  resolveWorkspace: (supabase: SupabaseClient, userId: string, workspaceId?: string) => Promise<AccessibleWorkspace>;
  prepare: (supabase: SupabaseClient, userId: string, input: { workspaceId?: string; localDate: string }) => Promise<PrepareDailyDigestResult>;
  rateLimit: (key: string) => Promise<void>;
  reserve: (supabase: SupabaseClient, input: ReserveInput) => Promise<DigestReservation>;
  loadEncryptedWebhook: (supabase: SupabaseClient, input: { workspaceId: string; channelId: string }) => Promise<string>;
  decryptWebhook: (stored: string) => string | null;
  deliver: (webhookUrl: string, payload: SlackDigestPayload) => Promise<SlackDeliveryOutcome>;
  finalize: (supabase: SupabaseClient, input: FinalizeInput) => Promise<boolean>;
};

const reservationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.enum(["no_digest_channel", "already_posted", "delivery_unknown"]) }).strict(),
  z.object({
    state: z.literal("reserved"),
    deliveryId: uuid,
    channelId: uuid,
    attemptNumber: z.number().int().min(1).max(10),
    message: slackPayloadSchema,
  }).strict(),
]);

async function reserveDelivery(supabase: SupabaseClient, input: ReserveInput): Promise<DigestReservation> {
  const { data, error } = await supabase.rpc("reserve_daily_digest_delivery", {
    target_organisation_id: input.workspaceId,
    target_digest_on: input.localDate,
    target_fact_hash: input.factHash,
    target_message: input.message,
  });
  if (error) throw new McpError("INTERNAL_ERROR");
  const parsed = reservationSchema.safeParse(data);
  if (!parsed.success) throw new McpError("INTERNAL_ERROR");
  return parsed.data as DigestReservation;
}

async function loadEncryptedWebhook(
  supabase: SupabaseClient,
  input: { workspaceId: string; channelId: string },
): Promise<string> {
  const { data, error } = await supabase.from("alert_channels")
    .select("config")
    .eq("id", input.channelId)
    .eq("organisation_id", input.workspaceId)
    .eq("type", "slack")
    .maybeSingle();
  if (error || !data) throw new McpError("SLACK_REJECTED");
  const parsed = z.object({ config: z.object({ webhookUrl: z.string().min(1) }).passthrough() }).safeParse(data);
  if (!parsed.success) throw new McpError("SLACK_REJECTED");
  return parsed.data.config.webhookUrl;
}

async function finalizeDelivery(supabase: SupabaseClient, input: FinalizeInput): Promise<boolean> {
  const { data, error } = await supabase.rpc("finalize_daily_digest_delivery", {
    target_delivery_id: input.deliveryId,
    target_attempt_number: input.attemptNumber,
    target_outcome: input.outcome,
    target_error_code: input.errorCode ?? null,
  });
  return !error && data === true;
}

const defaultDependencies: PostDailyDigestDependencies = {
  resolveWorkspace,
  prepare: prepareDailyDigest,
  rateLimit: (key) => enforceRateLimit(key, { limit: 5, windowMs: 60_000 }),
  reserve: reserveDelivery,
  loadEncryptedWebhook,
  decryptWebhook: decryptSecret,
  deliver: (webhookUrl, payload) => postSlackWebhook(webhookUrl, payload),
  finalize: finalizeDelivery,
};

function actionRateLimitKey(userId: string, clientId: string): string {
  const digest = createHash("sha256").update(`${userId}\0${clientId}`, "utf8").digest("hex");
  return `mcp-post-digest:${digest}`;
}

function preparedStateError(status: PrepareDailyDigestResult["status"]): McpErrorCode | null {
  if (status === "already_delivered") return "ALREADY_POSTED";
  if (status === "delivery_reserved" || status === "delivery_unknown") return "DELIVERY_UNKNOWN";
  return null;
}

function reservationStateError(state: Exclude<DigestReservation, { state: "reserved" }>["state"]): McpErrorCode {
  if (state === "no_digest_channel") return "NO_DIGEST_CHANNEL";
  if (state === "already_posted") return "ALREADY_POSTED";
  return "DELIVERY_UNKNOWN";
}

export async function postDailyDigest(
  request: {
    supabase: SupabaseClient;
    userId: string;
    clientId: string;
    input: PostDailyDigestInput;
  },
  dependencies: PostDailyDigestDependencies = defaultDependencies,
) {
  const input = postDailyDigestInputSchema.parse(request.input);
  const workspace = await dependencies.resolveWorkspace(request.supabase, request.userId, input.workspaceId);
  if (workspace.role !== "owner") throw new McpError("FORBIDDEN");

  try {
    await dependencies.rateLimit(actionRateLimitKey(request.userId, request.clientId));
  } catch {
    throw new McpError("RATE_LIMITED");
  }

  const prepared = await dependencies.prepare(request.supabase, request.userId, {
    workspaceId: workspace.id,
    localDate: input.localDate,
  });
  const stateError = preparedStateError(prepared.status);
  if (stateError) throw new McpError(stateError);
  if (prepared.factHash !== input.factHash) throw new McpError("STALE_DIGEST");

  const digestMessage = dailyDigestMessageSchema.parse({
    headline: input.headline,
    priorities: input.priorities,
    actions: input.actions,
  });
  if (!validateDigestMessageAgainstFacts(digestMessage, prepared.facts).ok) {
    throw new McpError("VALIDATION_ERROR");
  }
  const outgoing = slackPayloadSchema.parse(buildSlackDigestPayload(digestMessage, {
    workspaceName: prepared.facts.workspace.name,
    localDate: prepared.facts.localDate,
  })) as SlackDigestPayload;
  const reservation = await dependencies.reserve(request.supabase, {
    workspaceId: workspace.id,
    localDate: input.localDate,
    factHash: input.factHash,
    message: outgoing,
  });
  if (reservation.state !== "reserved") throw new McpError(reservationStateError(reservation.state));

  let validatedWebhook: string | null = null;
  try {
    const encrypted = await dependencies.loadEncryptedWebhook(request.supabase, {
      workspaceId: workspace.id,
      channelId: reservation.channelId,
    });
    const webhook = dependencies.decryptWebhook(encrypted);
    if (!webhook) throw new McpError("SLACK_REJECTED");
    validatedWebhook = validateSlackWebhookUrl(webhook).toString();
  } catch {
    // No external request occurred, so a bad/missing/decryption-failed stored
    // configuration is a confirmed failure and may be explicitly retried.
  }

  let result: SlackDeliveryOutcome;
  if (!validatedWebhook) {
    result = { outcome: "failed", errorCode: "SLACK_REJECTED" };
  } else {
    try {
      result = await dependencies.deliver(
        validatedWebhook,
        reservation.message,
      );
    } catch {
      // Once the transport begins, an exception cannot prove whether Slack
      // accepted the payload. Persist unknown and require human review.
      result = { outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" };
    }
  }

  const finalized = await dependencies.finalize(request.supabase, {
    deliveryId: reservation.deliveryId,
    attemptNumber: reservation.attemptNumber,
    outcome: result.outcome,
    ...(result.outcome === "delivered" ? {} : { errorCode: result.errorCode }),
  });
  if (!finalized) throw new McpError("DELIVERY_UNKNOWN");
  if (result.outcome !== "delivered") throw new McpError(result.errorCode);

  return {
    workspace: { id: workspace.id, name: workspace.name },
    localDate: input.localDate,
    status: "delivered" as const,
    delivery: { id: reservation.deliveryId, attemptNumber: reservation.attemptNumber },
  };
}

export function validateSlackWebhookUrl(value: string): URL {
  const url = new URL(value);
  const allowedHost = url.hostname === "hooks.slack.com" || url.hostname === "hooks.slack-gov.com";
  if (url.protocol !== "https:"
    || !allowedHost
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new Error("Invalid Slack incoming-webhook URL");
  }
  return url;
}

export async function postSlackWebhook(
  webhookUrl: string,
  payload: SlackDigestPayload,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<SlackDeliveryOutcome> {
  let response: Response;
  try {
    const url = validateSlackWebhookUrl(webhookUrl);
    response = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slackPayloadSchema.parse(payload)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch {
    return { outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" };
  }
  if (response.status >= 200 && response.status < 300) return { outcome: "delivered" };
  if (response.status === 429) return { outcome: "failed", errorCode: "RATE_LIMITED" };
  if (response.status >= 400 && response.status < 500 && response.status !== 408) {
    return { outcome: "failed", errorCode: "SLACK_REJECTED" };
  }
  return { outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" };
}
