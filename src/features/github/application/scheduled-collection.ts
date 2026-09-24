import type { ReconciliationScope, ReconciliationSummary } from "./materialise-approved-observations";
import type { CollectionRequest, CollectionSummary } from "./run-collection";
import { scheduledCollectionRequestKey } from "./run-collection";

export type ScheduledCollectionDependencies = {
  collect(request: CollectionRequest): Promise<CollectionSummary>;
  reconcile(scope: ReconciliationScope): Promise<ReconciliationSummary>;
  now(): Date;
};

export type ScheduledCollectionCycle = {
  collection: CollectionSummary;
  collectionFailed: boolean;
  materialisation: ReconciliationSummary;
  materialisationFailed: boolean;
  collectionHealth: "healthy" | "needs_attention";
  complete: boolean;
};

const failedMaterialisation: ReconciliationSummary = {
  runsConsidered: 0,
  materialised: 0,
  unchanged: 0,
  awaitingApproval: 0,
  needsAttention: 1,
};

const emptyCollection: CollectionSummary = {
  installationsChecked: 0,
  repositoriesChecked: 0,
  observationsStored: 0,
  repositoriesFailed: 0,
  repositoriesDeferred: 0,
  runsPartial: 0,
  terminalRuns: [],
};

export async function runScheduledGitHubCollection(
  dependencies: ScheduledCollectionDependencies,
  signal?: AbortSignal,
): Promise<ScheduledCollectionCycle> {
  let collection: CollectionSummary;
  let collectionFailed = false;
  try {
    collection = await dependencies.collect({
      trigger: "scheduled",
      requestKey: scheduledCollectionRequestKey(dependencies.now()),
      signal,
    });
  } catch {
    collection = { ...emptyCollection, terminalRuns: [] };
    collectionFailed = true;
  }

  let materialisation = failedMaterialisation;
  let materialisationFailed = false;
  try {
    materialisation = await dependencies.reconcile(collectionFailed
      ? { limit: 100 }
      : { limit: 100, terminalRuns: collection.terminalRuns });
  } catch {
    materialisationFailed = true;
  }

  const needsAttention = collectionFailed
    || collection.repositoriesFailed > 0
    || collection.repositoriesDeferred > 0
    || materialisationFailed
    || materialisation.needsAttention > 0;

  return {
    collection,
    collectionFailed,
    materialisation,
    materialisationFailed,
    collectionHealth: needsAttention ? "needs_attention" : "healthy",
    complete: !needsAttention,
  };
}

export function scheduledGitHubCollectionLogSummary(cycle: ScheduledCollectionCycle) {
  return {
    complete: cycle.complete,
    collectionHealth: cycle.collectionHealth,
    collectionFailed: cycle.collectionFailed,
    collection: {
      installationsChecked: cycle.collection.installationsChecked,
      repositoriesChecked: cycle.collection.repositoriesChecked,
      observationsStored: cycle.collection.observationsStored,
      repositoriesFailed: cycle.collection.repositoriesFailed,
      repositoriesDeferred: cycle.collection.repositoriesDeferred,
      runsPartial: cycle.collection.runsPartial,
    },
    materialisation: {
      runsConsidered: cycle.materialisation.runsConsidered,
      materialised: cycle.materialisation.materialised,
      unchanged: cycle.materialisation.unchanged,
      awaitingApproval: cycle.materialisation.awaitingApproval,
      needsAttention: cycle.materialisation.needsAttention,
    },
    materialisationFailed: cycle.materialisationFailed,
  };
}
