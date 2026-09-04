import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseNativeWebhookStore,
  type NativeWebhookStore,
  type NativeWebhookDatabase,
} from "@/features/integrations/application/webhook-ingestion";
import {
  hashJiraWebhookToken,
  readBoundedWebhookBody,
  sha256Hex,
  verifyJiraWebhookJwt,
  WebhookInputError,
} from "@/features/integrations/application/webhook-security";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getJiraProviderConfig } from "@/features/integrations/application/provider-config";
import { processNativeIntegrationSyncJobAndDrain } from "@/features/integrations/application/native-sync-worker";
import type { IntegrationSyncRpcDatabase } from "@/features/integrations/application/sync-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const maxBodyBytes = 256 * 1024;
const deliveryPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const supportedEvents = new Set(["jira:issue_created", "jira:issue_updated", "jira:issue_deleted"]);
const payloadSchema = z.object({
  timestamp: z.number().int().nonnegative().safe(),
  webhookEvent: z.string().min(1).max(100),
  matchedWebhookIds: z.array(z.number().int().positive().safe()).min(1).max(5),
  issue: z.object({
    id: z.string().regex(/^[1-9][0-9]{0,39}$/),
    key: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}-[1-9][0-9]{0,39}$/),
    fields: z.object({
      project: z.object({
        id: z.string().regex(/^[1-9][0-9]{0,39}$/),
        key: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
      }).strip(),
    }).strip(),
  }).strip(),
}).strip();

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

type RouteContext = { params: Promise<{ token: string }> };

export function createJiraWebhookHandler(input: {
  store: Pick<NativeWebhookStore, "findActiveJiraConnection" | "findActiveTarget" | "recordAndEnqueue">;
  getClientSecret: () => string;
  nowSeconds?: () => number;
  scheduleJob?: (jobId: string) => void;
}) {
  return async function handle(request: Request, context: RouteContext): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9_.-]{20,8192})$/.exec(authorization);
    let clientSecret: string;
    try { clientSecret = input.getClientSecret(); }
    catch { return jsonError(503, "webhook unavailable"); }
    if (!match || !verifyJiraWebhookJwt(match[1], clientSecret, input.nowSeconds?.())) {
      return jsonError(401, "invalid webhook");
    }
    const { token } = await context.params;
    let tokenHash: string;
    try { tokenHash = hashJiraWebhookToken(token); }
    catch { return jsonError(401, "invalid webhook"); }
    const identifier = request.headers.get("x-atlassian-webhook-identifier") ?? "";
    if (!deliveryPattern.test(identifier)) return jsonError(400, "invalid webhook");
    let raw: Uint8Array;
    try {
      raw = await readBoundedWebhookBody(request, maxBodyBytes);
    } catch (error) {
      return jsonError(error instanceof WebhookInputError && error.code === "body_too_large" ? 413 : 400, "invalid webhook");
    }
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown; }
    catch { return jsonError(400, "invalid webhook"); }
    const payload = payloadSchema.safeParse(decoded);
    if (!payload.success || !supportedEvents.has(payload.data.webhookEvent)) {
      return jsonError(400, "invalid webhook");
    }
    try {
      const connection = await input.store.findActiveJiraConnection(tokenHash);
      if (!connection) return jsonError(404, "webhook connection not found");
      if (
        !connection.jiraWebhookId
        || !payload.data.matchedWebhookIds.includes(Number(connection.jiraWebhookId))
      ) return jsonError(404, "webhook connection not found");
      const projectId = payload.data.issue.fields.project.id;
      const target = await input.store.findActiveTarget(connection, projectId);
      if (!target) return jsonError(404, "webhook target not found");
      const result = await input.store.recordAndEnqueue({
        connection,
        targetId: target.id,
        deliveryKey: `${connection.id}:${identifier}`,
        eventType: payload.data.webhookEvent,
        deliveryPayload: { issueId: payload.data.issue.id, projectId },
        payloadHash: sha256Hex(raw),
        kind: "provider_webhook",
        jobPayload: { eventType: payload.data.webhookEvent, issueId: payload.data.issue.id, projectId },
      });
      try { input.scheduleJob?.(result.jobId); } catch {
        // The durable queue remains the fallback when post-response scheduling is unavailable.
      }
      return NextResponse.json({ accepted: true, duplicate: !result.created }, { status: 202 });
    } catch {
      return jsonError(500, "webhook could not be persisted");
    }
  };
}

export async function POST(request: Request, context: RouteContext) {
  const database = createSupabaseServiceClient() as unknown as NativeWebhookDatabase;
  return createJiraWebhookHandler({
    store: createSupabaseNativeWebhookStore(database),
    getClientSecret: () => getJiraProviderConfig().clientSecret,
    scheduleJob: (jobId) => after(async () => {
      try {
        await processNativeIntegrationSyncJobAndDrain(
          database as unknown as IntegrationSyncRpcDatabase,
          jobId,
          { batchSize: 10, maxBatches: 2, timeBudgetMs: 8_000 },
        );
      } catch {
        // A failed wake-up stays durable for the scheduled integration worker.
      }
    }),
  })(request, context);
}
