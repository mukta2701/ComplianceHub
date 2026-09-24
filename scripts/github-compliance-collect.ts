import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildCollectionDependencies } from "../src/features/github/application/collection-deps";
import { buildMaterialisationDependencies, reconcileApprovedGitHubObservations } from "../src/features/github/application/materialise-approved-observations";
import {
  runScheduledGitHubCollection,
  scheduledGitHubCollectionLogSummary,
  type ScheduledCollectionCycle,
} from "../src/features/github/application/scheduled-collection";
import { runGitHubCollection } from "../src/features/github/application/run-collection";
import { readGitHubRuntimeConfig } from "../src/features/github/application/github-runtime-config";
import { createSupabaseServiceClient } from "../src/lib/supabase/service";

const SCHEDULED_COLLECTION_DEADLINE_MS = 240_000;

type DailyCollectionCommandDependencies = {
  run(): Promise<ScheduledCollectionCycle>;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
};

export async function runDailyCollectionCommand(dependencies: DailyCollectionCommandDependencies): Promise<number> {
  try {
    const cycle = await dependencies.run();
    dependencies.writeStdout(JSON.stringify({
      event: "github_daily_collection",
      ...scheduledGitHubCollectionLogSummary(cycle),
    }));
    return cycle.complete ? 0 : 1;
  } catch {
    dependencies.writeStderr("GitHub daily collection did not complete.");
    return 1;
  }
}

async function runCollection(): Promise<ScheduledCollectionCycle> {
  const runtime = readGitHubRuntimeConfig();
  const service = createSupabaseServiceClient();
  const collectionDependencies = buildCollectionDependencies(service, runtime);
  const deadline = AbortSignal.timeout(SCHEDULED_COLLECTION_DEADLINE_MS);

  return runScheduledGitHubCollection({
    collect: (request) => runGitHubCollection(collectionDependencies, request),
    reconcile: (scope) => reconcileApprovedGitHubObservations(buildMaterialisationDependencies(service), scope),
    now: () => new Date(),
  }, deadline);
}

async function main(): Promise<void> {
  const exitCode = await runDailyCollectionCommand({
    run: runCollection,
    writeStdout: (message) => process.stdout.write(`${message}\n`),
    writeStderr: (message) => process.stderr.write(`${message}\n`),
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
