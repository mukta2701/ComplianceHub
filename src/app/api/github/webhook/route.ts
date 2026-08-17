import { NextResponse } from "next/server";

import {
  GitHubWebhookInputError,
  isSupportedGitHubWebhookEvent,
  parseGitHubWebhookPayload,
  readBoundedRequestBytes,
  sha256Hex,
  validateGitHubWebhookHeaders,
  verifyGitHubWebhookSignature,
} from "@/features/github/application/webhook";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type InsertResult = { error: null | { code?: unknown } };
type InsertBuilder = { insert(value: Record<string, unknown>): PromiseLike<InsertResult> };
type ServiceClient = { from(table: string): InsertBuilder };

function response(status: number) {
  return NextResponse.json(status === 202 ? { accepted: true } : { error: "GitHub webhook rejected" }, { status });
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!secret) return response(503);

  try {
    const { deliveryId, eventName } = validateGitHubWebhookHeaders(
      request.headers.get("x-github-delivery"),
      request.headers.get("x-github-event"),
    );
    const body = await readBoundedRequestBytes(request.body, request.headers.get("content-length"));
    if (!verifyGitHubWebhookSignature(body, request.headers.get("x-hub-signature-256"), secret)) return response(401);

    const supported = isSupportedGitHubWebhookEvent(eventName);
    const routing = supported ? parseGitHubWebhookPayload(eventName, body) : null;
    const row: Record<string, unknown> = {
      provider_delivery_id: deliveryId,
      event_name: eventName,
      payload_sha256: sha256Hex(body),
    };
    if (routing) {
      row.provider_installation_id = routing.providerInstallationId;
      if (routing.providerRepositoryId !== null) row.provider_repository_id = routing.providerRepositoryId;
    } else {
      row.status = "ignored";
      row.processed_at = new Date().toISOString();
    }

    const service = createSupabaseServiceClient() as unknown as ServiceClient;
    const { error } = await service.from("github_webhook_deliveries").insert(row);
    if (!error || error.code === "23505") return response(202);
    return response(503);
  } catch (error) {
    if (error instanceof GitHubWebhookInputError) return response(error.status);
    return response(503);
  }
}
