import { describe, expect, it, vi } from "vitest";

import type { ScheduledCollectionCycle } from "./scheduled-collection";

const success: ScheduledCollectionCycle = {
  collection: {
    installationsChecked: 1,
    repositoriesChecked: 1,
    observationsStored: 15,
    repositoriesFailed: 0,
    repositoriesDeferred: 0,
    runsPartial: 0,
    terminalRuns: [{
      collectionRunId: "20000000-0000-4000-8000-000000000001",
      organisationId: "10000000-0000-4000-8000-000000000001",
      installationId: "30000000-0000-4000-8000-000000000001",
      repositoryId: "40000000-0000-4000-8000-000000000001",
      providerRepositoryId: 101,
      status: "succeeded",
    }],
  },
  collectionFailed: false,
  materialisation: {
    runsConsidered: 1,
    materialised: 1,
    unchanged: 0,
    awaitingApproval: 0,
    needsAttention: 0,
  },
  materialisationFailed: false,
  collectionHealth: "healthy",
  complete: true,
};

async function commandRunner() {
  const command = await import("../../../../scripts/github-compliance-collect");
  const runner = (command as unknown as {
    runDailyCollectionCommand?: (dependencies: {
      run(): Promise<ScheduledCollectionCycle>;
      writeStdout(message: string): void;
      writeStderr(message: string): void;
    }, options?: { deadlineMs?: number; onDeadline?(): void }) => Promise<number>;
  }).runDailyCollectionCommand;
  expect(runner).toBeTypeOf("function");
  if (!runner) throw new Error("daily collection command is missing");
  return runner;
}

describe("runDailyCollectionCommand", () => {
  it("returns success and prints only safe counts for a complete cycle", async () => {
    const run = vi.fn().mockResolvedValue(success);
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();
    const command = await commandRunner();

    const exitCode = await command({ run, writeStdout, writeStderr });

    expect(exitCode).toBe(0);
    expect(run).toHaveBeenCalledExactlyOnceWith();
    expect(writeStderr).not.toHaveBeenCalled();
    expect(writeStdout).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('"repositoriesChecked":1'));
    expect(writeStdout.mock.calls.join(" ")).not.toContain("10000000-0000-4000-8000-000000000001");
    expect(writeStdout.mock.calls.join(" ")).not.toContain("40000000-0000-4000-8000-000000000001");
  });

  it("returns failure but still reports a safe summary for an incomplete cycle", async () => {
    const run = vi.fn().mockResolvedValue({
      ...success,
      collection: { ...success.collection, repositoriesChecked: 0, observationsStored: 0, repositoriesFailed: 0, terminalRuns: [] },
      collectionFailed: true,
      collectionHealth: "needs_attention",
      complete: false,
    });
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();
    const command = await commandRunner();

    const exitCode = await command({ run, writeStdout, writeStderr });

    expect(exitCode).toBe(1);
    expect(writeStdout).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('"collectionFailed":true'));
    expect(writeStderr).not.toHaveBeenCalled();
  });

  it("redacts unexpected failures instead of printing provider or database details", async () => {
    const run = vi.fn().mockRejectedValue(new Error("private RPC response"));
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();
    const command = await commandRunner();

    const exitCode = await command({ run, writeStdout, writeStderr });

    expect(exitCode).toBe(1);
    expect(writeStdout).not.toHaveBeenCalled();
    expect(writeStderr).toHaveBeenCalledExactlyOnceWith("GitHub daily collection did not complete.");
    expect(writeStderr.mock.calls.join(" ")).not.toContain("private RPC response");
  });

  it("ends a stalled dependency at the overall deadline without exposing its detail", async () => {
    vi.useFakeTimers();
    try {
      const command = await commandRunner();
      const writeStdout = vi.fn();
      const writeStderr = vi.fn();
      const onDeadline = vi.fn();
      const result = command({
        run: () => new Promise<ScheduledCollectionCycle>(() => undefined),
        writeStdout,
        writeStderr,
      }, { deadlineMs: 250, onDeadline });

      await vi.advanceTimersByTimeAsync(250);

      expect(await result).toBe(1);
      expect(onDeadline).toHaveBeenCalledOnce();
      expect(writeStdout).not.toHaveBeenCalled();
      expect(writeStderr).toHaveBeenCalledExactlyOnceWith("GitHub daily collection did not complete.");
    } finally {
      vi.useRealTimers();
    }
  });
});
