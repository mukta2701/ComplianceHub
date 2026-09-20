import "server-only";

import { z } from "zod";

import type { ClaimedGitHubConnectionReconciliation } from "./reconcile-github-connection";
import type { GitHubConnectionHealth } from "../domain/connection-health";

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

export type ConnectionCycleDeliveryOutcome = "processed" | "failed";

export type GitHubConnectionCycleDependencies = {
  claimConnectionDeliveries(limit: number): Promise<unknown[]>;
  finalizeConnectionDelivery(
    delivery: { id: string; attemptCount: number },
    outcome: ConnectionCycleDeliveryOutcome,
    diagnosticCode: string | null,
  ): Promise<boolean>;
  scheduleConnection(providerInstallationId: number): Promise<boolean>;
  claimDueInstallations(limit: number): Promise<unknown[]>;
  loadInstallationContext(installationUuid: string): Promise<{
    providerInstallationId: number;
    organisationId: string;
    previousHealth: GitHubConnectionHealth;
    consecutiveFailures: number;
    expectedAccount: { id: number; login: string; type: "Organization" | "User" };
  }>;
  reconcileClaim(claim: ClaimedGitHubConnectionReconciliation): Promise<{
    decision: { health: string; closeIncident: boolean; openIncident: boolean; diagnostic: string | null };
    repositoriesSeen: number;
  }>;
  notifyTransition(input: {
    kind: "incident" | "recovery";
    installationId: string;
    organisationId: string;
    accountLogin: string;
    health: "partially_unavailable" | "owner_action_required" | "disconnected" | "healthy" | "retrying";
    diagnostic: string | null;
    occurredAt: string;
  }): Promise<unknown>;
};

export class GitHubConnectionCycleBudgetExceededError extends Error {
  constructor() {
    super("GitHub connection cycle exceeded its time budget");
    this.name = "GitHubConnectionCycleBudgetExceededError";
  }
}

export class GitHubConnectionCycleAbortedError extends Error {
  constructor() {
    super("GitHub connection cycle was aborted");
    this.name = "GitHubConnectionCycleAbortedError";
  }
}

function invalidConfiguration(): never {
  throw new Error("GitHub connection cycle configuration is invalid");
}

const uuid = z.uuid();
const deliverySchema = z.object({
  id: uuid,
  attemptCount: z.number().int().min(1).max(10),
  providerDeliveryId: z.string().min(1).max(100),
  eventName: z.enum(["installation", "installation_repositories", "repository"]),
  providerInstallationId: z.number().int().positive().safe(),
}).passthrough();

const dueRunSchema = z.object({
  runId: uuid,
  installationUuid: uuid,
}).passthrough();

function checkBudget(startedAtMs: number, timeBudgetMs: number): void {
  if (Date.now() - startedAtMs > timeBudgetMs) throw new GitHubConnectionCycleBudgetExceededError();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new GitHubConnectionCycleAbortedError();
}

export async function runGitHubConnectionCycle(
  deps: GitHubConnectionCycleDependencies,
  input: {
    executionId: string;
    maximumWebhookDeliveries: number;
    maximumInstallations: number;
    timeBudgetMs: number;
    signal?: AbortSignal;
  },
): Promise<GitHubConnectionCycleSummary> {
  if (!uuid.safeParse(input.executionId).success) invalidConfiguration();
  for (const limit of [input.maximumWebhookDeliveries, input.maximumInstallations]) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalidConfiguration();
  }
  if (!Number.isInteger(input.timeBudgetMs) || input.timeBudgetMs < 1 || input.timeBudgetMs > 300_000) {
    invalidConfiguration();
  }
  const startedAtMs = Date.now();
  const summary: GitHubConnectionCycleSummary = {
    executionId: input.executionId,
    webhookDeliveriesClaimed: 0,
    installationsClaimed: 0,
    healthy: 0,
    retrying: 0,
    actionRequired: 0,
    recovered: 0,
    ownershipLost: 0,
  };

  checkBudget(startedAtMs, input.timeBudgetMs);
  const deliveries = await deps.claimConnectionDeliveries(input.maximumWebhookDeliveries);
  if (deliveries.length > input.maximumWebhookDeliveries) invalidConfiguration();
  summary.webhookDeliveriesClaimed = deliveries.length;

  for (const value of deliveries) {
    const parsed = deliverySchema.safeParse(value);
    if (!parsed.success) {
      summary.ownershipLost += 1;
      continue;
    }
    if (input.signal?.aborted) {
      try {
        await deps.finalizeConnectionDelivery(
          { id: parsed.data.id, attemptCount: parsed.data.attemptCount }, "failed", "internal_error",
        );
        throwIfAborted(input.signal);
      } catch {
        summary.ownershipLost += 1;
      }
      throw new GitHubConnectionCycleAbortedError();
    }
    checkBudget(startedAtMs, input.timeBudgetMs);
    try {
      const scheduled = await deps.scheduleConnection(parsed.data.providerInstallationId);
      throwIfAborted(input.signal);
      if (await deps.finalizeConnectionDelivery(
        { id: parsed.data.id, attemptCount: parsed.data.attemptCount },
        scheduled ? "processed" : "failed",
        scheduled ? null : "invalid_response",
      )) {
        throwIfAborted(input.signal);
        continue;
      }
      throwIfAborted(input.signal);
      summary.ownershipLost += 1;
    } catch {
      if (input.signal?.aborted) throw new GitHubConnectionCycleAbortedError();
      try {
        const finalised = await deps.finalizeConnectionDelivery(
          { id: parsed.data.id, attemptCount: parsed.data.attemptCount }, "failed", "internal_error",
        );
        throwIfAborted(input.signal);
        if (finalised) continue;
      } catch {
        if (input.signal?.aborted) throw new GitHubConnectionCycleAbortedError();
        // Finalise loss is recorded below.
      }
      summary.ownershipLost += 1;
    }
  }

  checkBudget(startedAtMs, input.timeBudgetMs);
  throwIfAborted(input.signal);
  const due = await deps.claimDueInstallations(input.maximumInstallations);
  throwIfAborted(input.signal);
  if (due.length > input.maximumInstallations) invalidConfiguration();
  summary.installationsClaimed = due.length;
  const reconciled = new Set<string>();

  for (const value of due) {
    throwIfAborted(input.signal);
    checkBudget(startedAtMs, input.timeBudgetMs);
    const parsed = dueRunSchema.safeParse(value);
    if (!parsed.success || reconciled.has(parsed.data.installationUuid)) {
      if (parsed.success) continue;
      summary.ownershipLost += 1;
      continue;
    }
    reconciled.add(parsed.data.installationUuid);
    try {
      const context = await deps.loadInstallationContext(parsed.data.installationUuid);
      throwIfAborted(input.signal);
      const result = await deps.reconcileClaim({
        runId: parsed.data.runId,
        installationUuid: parsed.data.installationUuid,
        providerInstallationId: context.providerInstallationId,
        organisationId: context.organisationId,
        previousHealth: context.previousHealth,
        consecutiveFailures: context.consecutiveFailures,
        expectedAccount: context.expectedAccount,
      });
      throwIfAborted(input.signal);
      if (result.decision.closeIncident) summary.recovered += 1;
      else if (result.decision.health === "healthy") summary.healthy += 1;
      else if (result.decision.health === "retrying") summary.retrying += 1;
      else if (result.decision.health === "owner_action_required") summary.actionRequired += 1;
      else if (result.decision.health === "partially_unavailable") summary.actionRequired += 1;
      else if (result.decision.health === "disconnected") summary.actionRequired += 1;
      else summary.ownershipLost += 1;
      if (result.decision.openIncident || result.decision.health === "healthy") {
        try {
          await deps.notifyTransition({
            kind: result.decision.health === "healthy" ? "recovery" : "incident",
            installationId: parsed.data.installationUuid,
            organisationId: context.organisationId,
            accountLogin: context.expectedAccount.login,
            health: result.decision.health as "partially_unavailable" | "owner_action_required" | "disconnected" | "healthy" | "retrying",
            diagnostic: result.decision.diagnostic,
            occurredAt: new Date().toISOString(),
          });
        } catch {
          if (input.signal?.aborted) throw new GitHubConnectionCycleAbortedError();
          summary.ownershipLost += 1;
        }
      }
    } catch {
      if (input.signal?.aborted) throw new GitHubConnectionCycleAbortedError();
      summary.ownershipLost += 1;
    }
  }

  checkBudget(startedAtMs, input.timeBudgetMs);
  throwIfAborted(input.signal);
  return summary;
}
