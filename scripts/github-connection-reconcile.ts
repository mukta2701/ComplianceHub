import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  runGitHubConnectionCycle,
  type GitHubConnectionCycleInput,
  type GitHubConnectionCycleSummary,
} from "../src/features/github/application/run-github-connection-cycle";

type CycleRunner = (input: GitHubConnectionCycleInput) => Promise<GitHubConnectionCycleSummary>;
type SignalName = "SIGTERM" | "SIGINT";
type SignalRuntime = {
  once(signal: SignalName, handler: () => void): unknown;
  off(signal: SignalName, handler: () => void): unknown;
};

type CliDependencies = {
  environment: Record<string, string | undefined>;
  randomUUID(): string;
  runCycle: CycleRunner;
  stdout(value: string): void;
  stderr(value: string): void;
  signals: SignalRuntime;
};

const summarySchema = z.object({
  executionId: z.string().uuid(),
  webhookDeliveriesClaimed: z.number().int().nonnegative().max(100),
  installationsClaimed: z.number().int().nonnegative().max(100),
  healthy: z.number().int().nonnegative().max(100),
  retrying: z.number().int().nonnegative().max(100),
  actionRequired: z.number().int().nonnegative().max(100),
  recovered: z.number().int().nonnegative().max(100),
  ownershipLost: z.number().int().nonnegative().max(200),
}).strict().superRefine((value, context) => {
  const installationOutcomes = value.healthy + value.retrying + value.actionRequired;
  const deliveryOwnershipLoss = Math.max(0, value.ownershipLost - value.installationsClaimed);
  if (
    installationOutcomes > value.installationsClaimed
    || deliveryOwnershipLoss > value.webhookDeliveriesClaimed
  ) {
    context.addIssue({ code: "custom", message: "cycle counts do not reconcile" });
  }
  if (value.recovered > value.healthy) {
    context.addIssue({ code: "custom", message: "recovery count exceeds healthy count" });
  }
});

function boundedInteger(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("invalid cycle configuration");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error("invalid cycle configuration");
  return parsed;
}

export async function runGitHubConnectionReconcileCli(
  dependencies: Partial<CliDependencies> = {},
): Promise<0 | 1> {
  const environment = dependencies.environment ?? process.env;
  const uuid = dependencies.randomUUID ?? randomUUID;
  const runCycle = dependencies.runCycle ?? runGitHubConnectionCycle;
  const stdout = dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const stderr = dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  const signals = dependencies.signals ?? process;
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Connection cycle interrupted", "AbortError"));

  try {
    const executionId = uuid();
    if (!z.string().uuid().safeParse(executionId).success) throw new Error("invalid execution id");
    const input: GitHubConnectionCycleInput = {
      executionId,
      maximumWebhookDeliveries: boundedInteger(
        environment,
        "GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES",
        25,
        100,
      ),
      maximumInstallations: boundedInteger(
        environment,
        "GITHUB_CONNECTION_MAX_INSTALLATIONS",
        10,
        100,
      ),
      timeBudgetMs: boundedInteger(
        environment,
        "GITHUB_CONNECTION_TIME_BUDGET_MS",
        180_000,
        240_000,
      ),
      signal: controller.signal,
    };
    signals.once("SIGTERM", abort);
    signals.once("SIGINT", abort);
    const result = summarySchema.parse(await runCycle(input));
    if (result.executionId !== executionId || controller.signal.aborted) {
      throw new Error("cycle did not complete");
    }
    stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    stderr("GitHub connection reconciliation failed\n");
    return 1;
  } finally {
    signals.off("SIGTERM", abort);
    signals.off("SIGINT", abort);
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  void runGitHubConnectionReconcileCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
