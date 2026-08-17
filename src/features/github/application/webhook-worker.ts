import "server-only";

import { z } from "zod";

import type { DiagnosticCode } from "../domain/observation";
import { GitHubCollectionError } from "./github-collection-error";
import { runGitHubCollection, type CollectionDependencies, type CollectionRequest, type CollectionSummary } from "./run-collection";

export type ClaimedWebhookDelivery = {
  id: string;
  providerDeliveryId: string;
  attemptCount: number;
  providerInstallationId: number;
  providerRepositoryId: number | null;
  installationId: string | null;
  repositoryId: string | null;
};

export type WebhookOutcome = "processed" | "ignored" | "failed";
export type WebhookDiagnostic = DiagnosticCode | "invalid_payload" | "unsupported_event" | "internal_error";

export type WebhookWorkerDependencies = {
  claim(limit: number): Promise<ClaimedWebhookDelivery[]>;
  finalise(delivery: ClaimedWebhookDelivery, outcome: WebhookOutcome, diagnosticCode: WebhookDiagnostic | null): Promise<boolean>;
  runCollection(request: CollectionRequest): Promise<CollectionSummary>;
};

export type WebhookDrainSummary = {
  claimed: number;
  processed: number;
  ignored: number;
  failed: number;
  ownershipLost: number;
};

type QueryResult = { data: unknown; error: unknown };
type SupabaseServiceClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult> };

const uuid = z.string().uuid();
const claimedSchema = z.object({
  id: uuid,
  provider_delivery_id: uuid,
  attempt_count: z.number().int().min(1).max(10),
  provider_installation_id: z.number().int().positive().safe(),
  provider_repository_id: z.number().int().positive().safe().nullable(),
  installation_id: uuid.nullable(),
  repository_id: uuid.nullable(),
}).passthrough();
const collectionSummarySchema = z.object({
  installationsChecked: z.number().int().nonnegative(),
  repositoriesChecked: z.number().int().nonnegative(),
  observationsStored: z.number().int().nonnegative(),
  repositoriesFailed: z.number().int().nonnegative(),
  repositoriesDeferred: z.number().int().nonnegative(),
  runsPartial: z.number().int().nonnegative(),
}).strict();

function safeFailure(): Error {
  return new Error("GitHub webhook persistence failed");
}

export function buildWebhookWorkerDependencies(
  serviceInput: unknown,
  collectionDependencies: CollectionDependencies,
): WebhookWorkerDependencies {
  const service = serviceInput as SupabaseServiceClient;
  return {
    async claim(limit) {
      const { data, error } = await service.rpc("claim_github_webhook_deliveries_server", { target_limit: limit });
      if (error || !Array.isArray(data)) throw safeFailure();
      const parsed = z.array(claimedSchema).safeParse(data);
      if (!parsed.success) throw safeFailure();
      return parsed.data.map((row) => ({
        id: row.id,
        providerDeliveryId: row.provider_delivery_id,
        attemptCount: row.attempt_count,
        providerInstallationId: row.provider_installation_id,
        providerRepositoryId: row.provider_repository_id,
        installationId: row.installation_id,
        repositoryId: row.repository_id,
      }));
    },
    async finalise(delivery, outcome, diagnosticCode) {
      const { data, error } = await service.rpc("finalize_github_webhook_delivery_server", {
        target_delivery_id: delivery.id,
        target_attempt_count: delivery.attemptCount,
        target_status: outcome,
        target_diagnostic_code: diagnosticCode,
      });
      if (error || typeof data !== "boolean") throw safeFailure();
      return data;
    },
    runCollection: (request) => runGitHubCollection(collectionDependencies, request),
  };
}

function diagnosticFor(error: unknown): WebhookDiagnostic {
  return error instanceof GitHubCollectionError ? error.diagnosticCode : "internal_error";
}

export async function drainGitHubWebhookDeliveries(
  deps: WebhookWorkerDependencies,
  input: { limit: number; signal?: AbortSignal },
): Promise<WebhookDrainSummary> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw safeFailure();
  const deliveries = await deps.claim(input.limit);
  if (deliveries.length > input.limit) throw safeFailure();
  const summary: WebhookDrainSummary = { claimed: deliveries.length, processed: 0, ignored: 0, failed: 0, ownershipLost: 0 };

  for (const delivery of deliveries) {
    let outcome: WebhookOutcome = "processed";
    let diagnosticCode: WebhookDiagnostic | null = null;
    try {
      if (!delivery.installationId || (delivery.providerRepositoryId !== null && !delivery.repositoryId)) {
        outcome = "ignored";
      } else {
        const collection = await deps.runCollection({
          trigger: "webhook",
          requestKey: `webhook:${delivery.providerDeliveryId}`,
          installationId: delivery.installationId,
          repositoryId: delivery.providerRepositoryId === null ? undefined : delivery.repositoryId ?? undefined,
          signal: input.signal,
        });
        const validatedCollection = collectionSummarySchema.safeParse(collection);
        if (!validatedCollection.success) {
          outcome = "failed";
          diagnosticCode = "invalid_response";
        } else if (validatedCollection.data.repositoriesDeferred > 0) {
          outcome = "failed";
          diagnosticCode = "internal_error";
        }
      }
    } catch (error) {
      outcome = "failed";
      diagnosticCode = diagnosticFor(error);
    }

    try {
      if (!await deps.finalise(delivery, outcome, diagnosticCode)) {
        summary.ownershipLost += 1;
        continue;
      }
      summary[outcome] += 1;
    } catch {
      summary.ownershipLost += 1;
    }
  }
  return summary;
}
