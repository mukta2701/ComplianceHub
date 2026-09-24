import { describe, expect, it, vi } from "vitest";

import type { ReconciliationScope, ReconciliationSummary } from "./materialise-approved-observations";
import type { CollectionRequest, CollectionSummary } from "./run-collection";

type ScheduledCollectionRunner = (
  dependencies: {
    collect(request: CollectionRequest): Promise<CollectionSummary>;
    reconcile(scope: ReconciliationScope): Promise<ReconciliationSummary>;
    now(): Date;
  },
  signal?: AbortSignal,
) => Promise<{
  collection: CollectionSummary;
  materialisation: ReconciliationSummary;
  materialisationFailed: boolean;
  collectionHealth: "healthy" | "needs_attention";
  complete: boolean;
}>;

const emptyCollection: CollectionSummary = {
  installationsChecked: 0,
  repositoriesChecked: 0,
  observationsStored: 0,
  repositoriesFailed: 0,
  repositoriesDeferred: 0,
  runsPartial: 0,
  terminalRuns: [],
};

const emptyReconciliation: ReconciliationSummary = {
  runsConsidered: 0,
  materialised: 0,
  unchanged: 0,
  awaitingApproval: 0,
  needsAttention: 0,
};

async function scheduledRunner(): Promise<ScheduledCollectionRunner> {
  const scheduled = await import("./scheduled-collection");
  const runner = (scheduled as unknown as { runScheduledGitHubCollection?: ScheduledCollectionRunner }).runScheduledGitHubCollection;
  expect(runner).toBeTypeOf("function");
  if (!runner) throw new Error("scheduled collection runner is missing");
  return runner;
}

describe("runScheduledGitHubCollection", () => {
  it("uses the current UTC day key and carries every workspace run into a bounded reconciliation", async () => {
    const terminalRuns: CollectionSummary["terminalRuns"] = [
      { collectionRunId: "20000000-0000-4000-8000-000000000001", organisationId: "10000000-0000-4000-8000-000000000001", installationId: "30000000-0000-4000-8000-000000000001", repositoryId: "40000000-0000-4000-8000-000000000001", providerRepositoryId: 101, status: "succeeded" },
      { collectionRunId: "20000000-0000-4000-8000-000000000002", organisationId: "10000000-0000-4000-8000-000000000002", installationId: "30000000-0000-4000-8000-000000000002", repositoryId: "40000000-0000-4000-8000-000000000002", providerRepositoryId: 202, status: "partial" },
    ];
    const collect = vi.fn().mockResolvedValue({ ...emptyCollection, installationsChecked: 2, repositoriesChecked: 2, observationsStored: 30, terminalRuns });
    const reconcile = vi.fn().mockResolvedValue({ ...emptyReconciliation, runsConsidered: 2, materialised: 1, unchanged: 1 });
    const signal = new AbortController().signal;
    const runner = await scheduledRunner();

    const result = await runner({
      collect,
      reconcile,
      now: () => new Date("2026-09-24T23:59:59.000Z"),
    }, signal);

    expect(collect).toHaveBeenCalledExactlyOnceWith({ trigger: "scheduled", requestKey: "scheduled:2026-09-24", signal });
    expect(reconcile).toHaveBeenCalledExactlyOnceWith({ limit: 100, terminalRuns });
    expect(result).toMatchObject({ collectionHealth: "healthy", materialisationFailed: false, complete: true });

    const scheduled = await import("./scheduled-collection");
    expect(scheduled.scheduledGitHubCollectionLogSummary(result)).toEqual({
      complete: true,
      collectionHealth: "healthy",
      collection: {
        installationsChecked: 2,
        repositoriesChecked: 2,
        observationsStored: 30,
        repositoriesFailed: 0,
        repositoriesDeferred: 0,
        runsPartial: 0,
      },
      materialisation: {
        runsConsidered: 2,
        materialised: 1,
        unchanged: 1,
        awaitingApproval: 0,
        needsAttention: 0,
      },
      materialisationFailed: false,
    });
    expect(JSON.stringify(scheduled.scheduledGitHubCollectionLogSummary(result))).not.toContain("10000000-0000-4000-8000-000000000001");
  });

  it("keeps a repository failure visible while continuing to reconcile successful repositories", async () => {
    const terminalRuns = [
      { collectionRunId: "20000000-0000-4000-8000-000000000001", organisationId: "10000000-0000-4000-8000-000000000001", installationId: "30000000-0000-4000-8000-000000000001", repositoryId: "40000000-0000-4000-8000-000000000001", providerRepositoryId: 101, status: "succeeded" as const },
    ];
    const collect = vi.fn().mockResolvedValue({ ...emptyCollection, repositoriesChecked: 2, observationsStored: 15, repositoriesFailed: 1, terminalRuns });
    const reconcile = vi.fn().mockResolvedValue({ ...emptyReconciliation, runsConsidered: 1, materialised: 1 });
    const runner = await scheduledRunner();

    const result = await runner({ collect, reconcile, now: () => new Date("2026-09-24T08:00:00.000Z") });

    expect(reconcile).toHaveBeenCalledExactlyOnceWith({ limit: 100, terminalRuns });
    expect(result).toMatchObject({ collectionHealth: "needs_attention", materialisationFailed: false, complete: false });
  });

  it("treats partial compliance observations as a completed collection cycle", async () => {
    const collect = vi.fn().mockResolvedValue({ ...emptyCollection, repositoriesChecked: 1, observationsStored: 15, runsPartial: 1 });
    const reconcile = vi.fn().mockResolvedValue(emptyReconciliation);
    const runner = await scheduledRunner();

    const result = await runner({ collect, reconcile, now: () => new Date("2026-09-24T08:00:00.000Z") });

    expect(result).toMatchObject({ collectionHealth: "healthy", complete: true });
  });

  it("returns a safe incomplete result when reconciliation fails", async () => {
    const collect = vi.fn().mockResolvedValue(emptyCollection);
    const reconcile = vi.fn().mockRejectedValue(new Error("private RPC detail"));
    const runner = await scheduledRunner();

    const result = await runner({ collect, reconcile, now: () => new Date("2026-09-24T08:00:00.000Z") });

    expect(result.materialisation).toEqual({ ...emptyReconciliation, needsAttention: 1 });
    expect(result).toMatchObject({ collectionHealth: "needs_attention", materialisationFailed: true, complete: false });
    expect(JSON.stringify(result)).not.toContain("private RPC detail");
  });
});
