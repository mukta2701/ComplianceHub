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

export type WebhookDeliveryLease = Pick<ClaimedWebhookDelivery, "id" | "attemptCount">;

export type WebhookOutcome = "processed" | "ignored" | "failed";
export type WebhookDiagnostic = DiagnosticCode | "invalid_payload" | "unsupported_event" | "internal_error";

export type WebhookWorkerDependencies = {
  claim(limit: number): Promise<unknown[]>;
  finalise(delivery: WebhookDeliveryLease, outcome: WebhookOutcome, diagnosticCode: WebhookDiagnostic | null): Promise<boolean>;
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
  providerDeliveryId: z.string().regex(/^[!-~]{1,100}$/),
  attemptCount: z.number().int().min(1).max(10),
  providerInstallationId: z.number().int().positive().safe(),
  providerRepositoryId: z.number().int().positive().safe().nullable(),
  installationId: uuid.nullable(),
  repositoryId: uuid.nullable(),
}).strict();
const leaseSchema = claimedSchema.pick({ id: true, attemptCount: true }).passthrough();
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
      return data.map((value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
        const row = value as Record<string, unknown>;
        return {
          id: row.id,
          providerDeliveryId: row.provider_delivery_id,
          attemptCount: row.attempt_count,
          providerInstallationId: row.provider_installation_id,
          providerRepositoryId: row.provider_repository_id,
          installationId: row.installation_id,
          repositoryId: row.repository_id,
        };
      });
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

  for (const value of deliveries) {
    const lease = leaseSchema.safeParse(value);
    if (!lease.success) {
      summary.ownershipLost += 1;
      continue;
    }
    if (input.signal?.aborted) {
      try {
        if (await deps.finalise(lease.data, "failed", "internal_error")) summary.failed += 1;
        else summary.ownershipLost += 1;
      } catch {
        summary.ownershipLost += 1;
      }
      continue;
    }
    const parsed = claimedSchema.safeParse(value);
    if (!parsed.success) {
      try {
        if (await deps.finalise(lease.data, "failed", "invalid_response")) summary.failed += 1;
        else summary.ownershipLost += 1;
      } catch {
        summary.ownershipLost += 1;
      }
      continue;
    }
    const delivery = parsed.data;
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

    if (input.signal?.aborted && outcome === "processed") {
      outcome = "failed";
      diagnosticCode = "internal_error";
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
