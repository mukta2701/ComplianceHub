import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { decryptSecret } from "@/lib/security/secrets";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  postSlackIncomingWebhook,
  validateSlackIncomingWebhookUrl,
} from "@/lib/integrations/slack-incoming-webhook";
import {
  approveSlackDestination,
  approveStoredSlackDestination,
} from "./slack-destination-policy";
import { McpError, type McpErrorCode } from "../auth/errors";
import {
  buildSlackDigestPayload,
  dailyDigestMessageSchema,
  validateDigestMessageAgainstFacts,
} from "../domain/digest";
import { prepareDailyDigest, type PrepareDailyDigestResult } from "./mcp-reads";
import { resolveWorkspace, type AccessibleWorkspace } from "./workspace-access";

const uuid = z.uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day;
}, "localDate must be a real calendar date");
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
  | { outcome: "failed"; errorCode: "SLACK_REJECTED" | "RATE_LIMITED" | "NO_DIGEST_CHANNEL" | "INTERNAL_ERROR" }
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
  actorUserId: string;
  workspaceId: string;
  expectedChannelId: string;
  localDate: string;
  factHash: string;
  message: SlackDigestPayload;
};

type SelectedSlackDestination = {
  channelId: string;
  encryptedWebhook: string;
  webhookSha256: string | null;
};

type FinalizeInput = {
  actorUserId: string;
  deliveryId: string;
  attemptNumber: number;
  outcome: SlackDeliveryOutcome["outcome"];
  errorCode?: "SLACK_REJECTED" | "RATE_LIMITED" | "NO_DIGEST_CHANNEL" | "INTERNAL_ERROR" | "DELIVERY_UNKNOWN";
};

export type PostDailyDigestDependencies = {
  resolveWorkspace: (supabase: SupabaseClient, userId: string, workspaceId?: string) => Promise<AccessibleWorkspace>;
  prepare: (supabase: SupabaseClient, userId: string, input: { workspaceId?: string; localDate: string }) => Promise<PrepareDailyDigestResult>;
  rateLimit: (key: string) => Promise<void>;
  createDeliveryClient: () => SupabaseClient;
  reserve: (supabase: SupabaseClient, input: ReserveInput) => Promise<DigestReservation>;
  loadSelectedSlackDestination: (
    supabase: SupabaseClient,
    input: { workspaceId: string },
  ) => Promise<SelectedSlackDestination | null>;
  decryptWebhook: (stored: string) => string | null;
  isChannelActive: (supabase: SupabaseClient, input: { workspaceId: string; channelId: string }) => Promise<boolean>;
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

export async function reserveDelivery(supabase: SupabaseClient, input: ReserveInput): Promise<DigestReservation> {
  const { data, error } = await supabase.rpc("reserve_daily_digest_delivery_server", {
    target_actor_id: input.actorUserId,
    target_expected_channel_id: input.expectedChannelId,
    target_organisation_id: input.workspaceId,
    target_digest_on: input.localDate,
    target_fact_hash: input.factHash,
    target_message: input.message,
  });
  if (error) throw new McpError(error.code === "42501" ? "FORBIDDEN" : "INTERNAL_ERROR");
  const parsed = reservationSchema.safeParse(data);
  if (!parsed.success) throw new McpError("INTERNAL_ERROR");
  return parsed.data as DigestReservation;
}

async function loadSelectedSlackDestination(
  supabase: SupabaseClient,
  input: { workspaceId: string },
): Promise<SelectedSlackDestination | null> {
  const { data, error } = await supabase.from("alert_channels")
    .select("id,config")
    .eq("organisation_id", input.workspaceId)
    .eq("type", "slack")
    .eq("enabled", true)
    .eq("daily_digest_enabled", true)
    .is("revoked_at", null)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new McpError("INTERNAL_ERROR");
  if (!data) return null;
  const parsed = z.object({
    id: uuid,
    config: z.object({
      webhookUrl: z.string().min(1),
      webhookSha256: z.string().nullable().optional(),
    }).passthrough(),
  }).safeParse(data);
  if (!parsed.success) throw new McpError("SLACK_REJECTED");
  return {
    channelId: parsed.data.id,
    encryptedWebhook: parsed.data.config.webhookUrl,
    webhookSha256: parsed.data.config.webhookSha256 ?? null,
  };
}

async function loadApprovedSlackDestination(
  dependencies: Pick<PostDailyDigestDependencies, "loadSelectedSlackDestination" | "decryptWebhook">,
  supabase: SupabaseClient,
  input: { workspaceId: string },
): Promise<{ channelId: string; canonicalUrl: string } | null> {
  const selected = await dependencies.loadSelectedSlackDestination(supabase, input);
  if (!selected) return null;

  const stored = approveStoredSlackDestination({
    webhookUrl: selected.encryptedWebhook,
    webhookSha256: selected.webhookSha256,
  });
  if (stored.status !== "approved") throw new McpError("SLACK_REJECTED");

  try {
    const decrypted = dependencies.decryptWebhook(stored.encryptedWebhook);
    const approved = decrypted ? approveSlackDestination(decrypted) : { status: "not_approved" as const };
    if (approved.status !== "approved") throw new McpError("SLACK_REJECTED");
    return { channelId: selected.channelId, canonicalUrl: approved.canonicalUrl };
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError("SLACK_REJECTED");
  }
}

async function isChannelActive(
  supabase: SupabaseClient,
  input: { workspaceId: string; channelId: string },
): Promise<boolean> {
  const { data, error } = await supabase.from("alert_channels")
    .select("id")
    .eq("id", input.channelId)
    .eq("organisation_id", input.workspaceId)
    .eq("type", "slack")
    .eq("enabled", true)
    .eq("daily_digest_enabled", true)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new McpError("INTERNAL_ERROR");
  return data !== null;
}

async function finalizeDelivery(supabase: SupabaseClient, input: FinalizeInput): Promise<boolean> {
  const { data, error } = await supabase.rpc("finalize_daily_digest_delivery_server", {
    target_actor_id: input.actorUserId,
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
  createDeliveryClient: createSupabaseServiceClient,
  reserve: reserveDelivery,
  loadSelectedSlackDestination,
  decryptWebhook: decryptSecret,
  isChannelActive,
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

async function finalizeOrDeliveryUnknown(
  dependencies: PostDailyDigestDependencies,
  deliveryClient: SupabaseClient,
  input: FinalizeInput,
): Promise<void> {
  try {
    if (!await dependencies.finalize(deliveryClient, input)) {
      throw new Error("Daily digest finalization was not confirmed");
    }
  } catch {
    throw new McpError("DELIVERY_UNKNOWN");
  }
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

  const prepared = await dependencies.prepare(request.supabase, request.userId, {
    workspaceId: workspace.id,
    localDate: input.localDate,
  });
  const stateError = preparedStateError(prepared.status);
  if (stateError) throw new McpError(stateError);
  if (prepared.factHash !== input.factHash) throw new McpError("STALE_DIGEST");
  if (prepared.status === "delivery_failed"
    && (!prepared.delivery || prepared.delivery.factHash !== prepared.factHash)) {
    throw new McpError("STALE_DIGEST");
  }

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

  let selected: { channelId: string; canonicalUrl: string } | null;
  try {
    selected = await loadApprovedSlackDestination(dependencies, request.supabase, {
      workspaceId: workspace.id,
    });
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError("INTERNAL_ERROR");
  }
  if (!selected) throw new McpError("NO_DIGEST_CHANNEL");

  try {
    await dependencies.rateLimit(actionRateLimitKey(request.userId, request.clientId));
  } catch {
    throw new McpError("RATE_LIMITED");
  }

  // The service-role capability is constructed only after the OAuth user has
  // passed workspace, Owner, current-facts, closed-world message, and exact
  // server-approved destination checks.
  const deliveryClient = dependencies.createDeliveryClient();
  const reservation = await dependencies.reserve(deliveryClient, {
    actorUserId: request.userId,
    workspaceId: workspace.id,
    expectedChannelId: selected.channelId,
    localDate: input.localDate,
    factHash: input.factHash,
    message: outgoing,
  });
  if (reservation.state !== "reserved") throw new McpError(reservationStateError(reservation.state));
  if (reservation.channelId !== selected.channelId) {
    await finalizeOrDeliveryUnknown(dependencies, deliveryClient, {
      actorUserId: request.userId,
      deliveryId: reservation.deliveryId,
      attemptNumber: reservation.attemptNumber,
      outcome: "failed",
      errorCode: "NO_DIGEST_CHANNEL",
    });
    throw new McpError("NO_DIGEST_CHANNEL");
  }

  let result: SlackDeliveryOutcome;
  let active: boolean;
  try {
    active = await dependencies.isChannelActive(deliveryClient, {
      workspaceId: workspace.id,
      channelId: reservation.channelId,
    });
  } catch {
    await finalizeOrDeliveryUnknown(dependencies, deliveryClient, {
      actorUserId: request.userId,
      deliveryId: reservation.deliveryId,
      attemptNumber: reservation.attemptNumber,
      outcome: "failed",
      errorCode: "INTERNAL_ERROR",
    });
    throw new McpError("INTERNAL_ERROR");
  }
  if (!active) {
    result = { outcome: "failed", errorCode: "NO_DIGEST_CHANNEL" };
  } else {
    const finalApproval = approveSlackDestination(selected.canonicalUrl);
    if (finalApproval.status !== "approved") {
      result = { outcome: "failed", errorCode: "SLACK_REJECTED" };
    } else {
      try {
        result = await dependencies.deliver(
          finalApproval.canonicalUrl,
          reservation.message,
        );
      } catch {
        // Once the transport begins, an exception cannot prove whether Slack
        // accepted the payload. Persist unknown and require human review.
        result = { outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" };
      }
    }
  }

  await finalizeOrDeliveryUnknown(dependencies, deliveryClient, {
    actorUserId: request.userId,
    deliveryId: reservation.deliveryId,
    attemptNumber: reservation.attemptNumber,
    outcome: result.outcome,
    ...(result.outcome === "delivered" ? {} : { errorCode: result.errorCode }),
  });
  if (result.outcome !== "delivered") throw new McpError(result.errorCode);

  return {
    workspace: { id: workspace.id, name: workspace.name },
    localDate: input.localDate,
    status: "delivered" as const,
    delivery: { id: reservation.deliveryId, attemptNumber: reservation.attemptNumber },
  };
}

export const validateSlackWebhookUrl = validateSlackIncomingWebhookUrl;

export async function postSlackWebhook(
  webhookUrl: string,
  payload: SlackDigestPayload,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<SlackDeliveryOutcome> {
  const approved = approveSlackDestination(webhookUrl);
  if (approved.status !== "approved") {
    return { outcome: "failed", errorCode: "SLACK_REJECTED" };
  }
  let result;
  try {
    result = await postSlackIncomingWebhook(
      approved.canonicalUrl,
      slackPayloadSchema.parse(payload),
      options,
    );
  } catch {
    return { outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" };
  }
  if (result.kind === "transport_error") return { outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" };
  if (result.status >= 200 && result.status < 300) return { outcome: "delivered" };
  if (result.status === 429) return { outcome: "failed", errorCode: "RATE_LIMITED" };
  if (result.status >= 400 && result.status < 500 && result.status !== 408) {
    return { outcome: "failed", errorCode: "SLACK_REJECTED" };
  }
  return { outcome: "unknown", errorCode: "DELIVERY_UNKNOWN" };
}
