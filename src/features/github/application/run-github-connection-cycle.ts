import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createAppJwt, createInstallationInventoryToken } from "./github-app-auth";
import {
  buildGitHubConnectionStore,
  type ClaimedGitHubConnectionReconciliation,
} from "./github-connection-store";
import {
  readInstallationMetadata,
  readInstallationRepositories,
} from "./github-installation-api";
import { getGitHubConnectionConfig } from "./github-runtime-config";
import {
  reconcileGitHubConnection,
  type GitHubConnectionReconciliationResult,
} from "./reconcile-github-connection";
import {
  buildGitHubConnectionWebhookDependencies,
  drainGitHubConnectionWebhookDeliveries,
  type WebhookDrainSummary,
} from "./webhook-worker";

export type GitHubConnectionCycleSummary = {
  executionId: string;
  webhookDeliveriesClaimed: number;
  installationsClaimed: number;
  healthy: number;
  retrying: number;
  actionRequired: number;
  recovered: number;
  ownershipLost: number;
};

export type GitHubConnectionCycleInput = {
  executionId: string;
  maximumWebhookDeliveries: number;
  maximumInstallations: number;
  timeBudgetMs: number;
  signal?: AbortSignal;
};

export type GitHubConnectionCycleDependencies = {
  drainConnectionWebhooks(input: { limit: number; signal?: AbortSignal }): Promise<WebhookDrainSummary>;
  claimDue(input: {
    workerId: string;
    limit: number;
    now: string;
  }): Promise<ClaimedGitHubConnectionReconciliation[]>;
  reconcile(claim: ClaimedGitHubConnectionReconciliation): Promise<GitHubConnectionReconciliationResult>;
  now(): Date;
};

const cycleInputSchema = z.object({
  executionId: z.string().uuid(),
  maximumWebhookDeliveries: z.number().int().min(1).max(100),
  maximumInstallations: z.number().int().min(1).max(100),
  timeBudgetMs: z.number().int().min(1).max(240_000),
  signal: z.instanceof(AbortSignal).optional(),
}).strict();

const webhookSummarySchema = z.object({
  claimed: z.number().int().nonnegative().max(100),
  processed: z.number().int().nonnegative().max(100),
  ignored: z.number().int().nonnegative().max(100),
  failed: z.number().int().nonnegative().max(100),
  ownershipLost: z.number().int().nonnegative().max(100),
}).strict().refine((value) => (
  value.processed + value.ignored + value.failed + value.ownershipLost === value.claimed
));

const reconciliationResultSchema = z.object({
  outcome: z.enum(["success", "partial", "temporary_failure", "action_required", "disconnected"]),
  incidentTransition: z.enum(["none", "opened", "remained_open", "recovered"]),
}).passthrough();

function cycleFailure(): Error {
  return new Error("GitHub connection cycle failed");
}

function currentTime(dependencies: GitHubConnectionCycleDependencies): Date {
  const now = dependencies.now();
  if (!Number.isFinite(now.getTime())) throw cycleFailure();
  return now;
}

function ensureActive(
  dependencies: GitHubConnectionCycleDependencies,
  signal: AbortSignal | undefined,
  deadlineAt: number,
): void {
  if (signal?.aborted || currentTime(dependencies).getTime() >= deadlineAt) throw cycleFailure();
}

export function buildGitHubConnectionCycleRunner(
  dependencies: GitHubConnectionCycleDependencies,
): (input: GitHubConnectionCycleInput) => Promise<GitHubConnectionCycleSummary> {
  return async (input) => {
    const parsed = cycleInputSchema.safeParse(input);
    if (!parsed.success) throw cycleFailure();
    const startedAt = currentTime(dependencies).getTime();
    const deadlineAt = startedAt + parsed.data.timeBudgetMs;
    if (!Number.isSafeInteger(deadlineAt)) throw cycleFailure();
    ensureActive(dependencies, parsed.data.signal, deadlineAt);

    const webhookResult = webhookSummarySchema.safeParse(await dependencies.drainConnectionWebhooks({
      limit: parsed.data.maximumWebhookDeliveries,
      signal: parsed.data.signal,
    }));
    if (!webhookResult.success || webhookResult.data.claimed > parsed.data.maximumWebhookDeliveries) {
      throw cycleFailure();
    }
    ensureActive(dependencies, parsed.data.signal, deadlineAt);

    const claimTime = currentTime(dependencies).toISOString();
    const claims = await dependencies.claimDue({
      workerId: parsed.data.executionId,
      limit: parsed.data.maximumInstallations,
      now: claimTime,
    });
    if (!Array.isArray(claims) || claims.length > parsed.data.maximumInstallations) throw cycleFailure();
    ensureActive(dependencies, parsed.data.signal, deadlineAt);

    const summary: GitHubConnectionCycleSummary = {
      executionId: parsed.data.executionId,
      webhookDeliveriesClaimed: webhookResult.data.claimed,
      installationsClaimed: claims.length,
      healthy: 0,
      retrying: 0,
      actionRequired: 0,
      recovered: 0,
      ownershipLost: webhookResult.data.ownershipLost,
    };
    const processedRuns = new Set<string>();
    const processedInstallations = new Set<string>();

    for (const claim of claims) {
      ensureActive(dependencies, parsed.data.signal, deadlineAt);
      if (
        claim.workerId !== parsed.data.executionId
        || processedRuns.has(claim.runId)
        || processedInstallations.has(claim.installationId)
      ) {
        summary.ownershipLost += 1;
        continue;
      }
      processedRuns.add(claim.runId);
      processedInstallations.add(claim.installationId);

      try {
        const parsedResult = reconciliationResultSchema.safeParse(await dependencies.reconcile(claim));
        if (!parsedResult.success) {
          summary.ownershipLost += 1;
        } else {
          switch (parsedResult.data.outcome) {
            case "success":
              summary.healthy += 1;
              break;
            case "temporary_failure":
              summary.retrying += 1;
              break;
            case "partial":
            case "action_required":
            case "disconnected":
              summary.actionRequired += 1;
              break;
          }
          if (parsedResult.data.incidentTransition === "recovered") summary.recovered += 1;
        }
      } catch {
        summary.ownershipLost += 1;
      }
      ensureActive(dependencies, parsed.data.signal, deadlineAt);
    }

    return summary;
  };
}

function requiredRuntimeValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.length > 20_000) throw cycleFailure();
  return value;
}

function buildProductionDependencies(): GitHubConnectionCycleDependencies {
  const supabaseUrl = requiredRuntimeValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredRuntimeValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!z.string().url().safeParse(supabaseUrl).success) throw cycleFailure();
  const config = getGitHubConnectionConfig();
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const webhook = buildGitHubConnectionWebhookDependencies(service);
  const store = buildGitHubConnectionStore(service);
  const reconciliationDependencies = {
    createAppJwt: () => createAppJwt(
      { appId: config.appId, privateKey: config.privateKey },
      new Date(),
    ),
    createInstallationToken: createInstallationInventoryToken,
    readMetadata: readInstallationMetadata,
    readRepositories: readInstallationRepositories,
    finalize: store.finalize,
    now: () => new Date(),
  };
  return {
    drainConnectionWebhooks: (input) => drainGitHubConnectionWebhookDeliveries(webhook, input),
    claimDue: store.claimDue,
    reconcile: (claim) => reconcileGitHubConnection(reconciliationDependencies, claim),
    now: () => new Date(),
  };
}

export async function runGitHubConnectionCycle(
  input: GitHubConnectionCycleInput,
): Promise<GitHubConnectionCycleSummary> {
  return buildGitHubConnectionCycleRunner(buildProductionDependencies())(input);
}
