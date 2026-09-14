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
  buildGitHubConnectionAlertDependencies,
  queueGitHubConnectionNotice,
  type GitHubConnectionNotice,
} from "./github-connection-alerts";
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
    signal?: AbortSignal;
  }): Promise<ClaimedGitHubConnectionReconciliation[]>;
  reconcile(
    claim: ClaimedGitHubConnectionReconciliation,
    signal: AbortSignal,
  ): Promise<GitHubConnectionReconciliationResult>;
  queueConnectionNotice(notice: GitHubConnectionNotice, signal?: AbortSignal): Promise<{
    inAppQueued: number;
    slackQueued: number;
  }>;
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
  diagnostic: z.enum([
    "provider_rate_limited",
    "provider_temporary_failure",
    "installation_suspended",
    "installation_revoked",
    "permission_mismatch",
    "account_mismatch",
    "repository_unavailable",
    "invalid_provider_response",
    "internal_failure",
  ]).nullable(),
  incidentTransition: z.enum(["none", "opened", "remained_open", "recovered"]),
  effectiveHealth: z.enum([
    "healthy",
    "retrying",
    "partially_unavailable",
    "owner_action_required",
    "disconnected",
  ]),
}).passthrough();

function cycleFailure(): Error {
  return new Error("GitHub connection cycle failed");
}

function cycleTimeout(): DOMException {
  return new DOMException("GitHub connection cycle deadline reached", "TimeoutError");
}

function cycleInterrupted(): DOMException {
  return new DOMException("GitHub connection cycle interrupted", "AbortError");
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
    const cycle = new AbortController();
    const abortFromInput = () => cycle.abort(cycleInterrupted());
    let inputListenerAttached = false;
    if (parsed.data.signal?.aborted) {
      abortFromInput();
    } else if (parsed.data.signal) {
      parsed.data.signal.addEventListener("abort", abortFromInput, { once: true });
      inputListenerAttached = true;
    }
    const deadlineTimer = setTimeout(() => cycle.abort(cycleTimeout()), parsed.data.timeBudgetMs);

    try {
      ensureActive(dependencies, cycle.signal, deadlineAt);

      let webhookResponse: WebhookDrainSummary;
      try {
        webhookResponse = await dependencies.drainConnectionWebhooks({
          limit: parsed.data.maximumWebhookDeliveries,
          signal: cycle.signal,
        });
      } catch {
        throw cycleFailure();
      }
      const webhookResult = webhookSummarySchema.safeParse(webhookResponse);
      if (!webhookResult.success || webhookResult.data.claimed > parsed.data.maximumWebhookDeliveries) {
        throw cycleFailure();
      }
      ensureActive(dependencies, cycle.signal, deadlineAt);

      const claimTime = currentTime(dependencies).toISOString();
      let claims: ClaimedGitHubConnectionReconciliation[];
      try {
        claims = await dependencies.claimDue({
          workerId: parsed.data.executionId,
          limit: parsed.data.maximumInstallations,
          now: claimTime,
          signal: cycle.signal,
        });
      } catch {
        throw cycleFailure();
      }
      if (!Array.isArray(claims) || claims.length > parsed.data.maximumInstallations) throw cycleFailure();
      ensureActive(dependencies, cycle.signal, deadlineAt);

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
        ensureActive(dependencies, cycle.signal, deadlineAt);
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

        let reconciliationResponse: GitHubConnectionReconciliationResult;
        try {
          reconciliationResponse = await dependencies.reconcile(claim, cycle.signal);
        } catch {
          summary.ownershipLost += 1;
          ensureActive(dependencies, cycle.signal, deadlineAt);
          continue;
        }
        const parsedResult = reconciliationResultSchema.safeParse(reconciliationResponse);
        if (!parsedResult.success) {
          summary.ownershipLost += 1;
        } else {
          if (parsedResult.data.incidentTransition !== "none") {
            try {
              await dependencies.queueConnectionNotice({
                kind: parsedResult.data.incidentTransition === "recovered" ? "recovery" : "incident",
                runId: claim.runId,
                installationId: claim.installationId,
                organisationId: claim.organisationId,
                accountLogin: claim.account.login,
                health: parsedResult.data.effectiveHealth,
                diagnostic: parsedResult.data.diagnostic,
                occurredAt: claim.attemptedAt,
                connectionHref: "/app/integrations",
              }, cycle.signal);
            } catch {
              ensureActive(dependencies, cycle.signal, deadlineAt);
            }
          }
          switch (parsedResult.data.effectiveHealth) {
            case "healthy":
              summary.healthy += 1;
              break;
            case "retrying":
              summary.retrying += 1;
              break;
            case "partially_unavailable":
            case "owner_action_required":
            case "disconnected":
              summary.actionRequired += 1;
              break;
          }
          if (parsedResult.data.incidentTransition === "recovered") summary.recovered += 1;
        }
        ensureActive(dependencies, cycle.signal, deadlineAt);
      }

      return summary;
    } finally {
      clearTimeout(deadlineTimer);
      if (inputListenerAttached) {
        parsed.data.signal?.removeEventListener("abort", abortFromInput);
      }
    }
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
  const alerts = buildGitHubConnectionAlertDependencies(service);
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
    reconcile: (claim, signal) => reconcileGitHubConnection(reconciliationDependencies, claim, signal),
    queueConnectionNotice: (notice, signal) => queueGitHubConnectionNotice(alerts, notice, signal),
    now: () => new Date(),
  };
}

export async function runGitHubConnectionCycle(
  input: GitHubConnectionCycleInput,
): Promise<GitHubConnectionCycleSummary> {
  return buildGitHubConnectionCycleRunner(buildProductionDependencies())(input);
}
