// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { runGitHubConnectionReconcileCli } from "./github-connection-reconcile";

const executionId = "10000000-0000-4000-8000-000000000001";
const summary = {
  executionId,
  webhookDeliveriesClaimed: 2,
  installationsClaimed: 1,
  healthy: 1,
  retrying: 0,
  actionRequired: 0,
  recovered: 0,
  ownershipLost: 0,
};

function signals() {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    runtime: {
      once: vi.fn((signal: string, handler: () => void) => { handlers.set(signal, handler); }),
      off: vi.fn((signal: string, handler: () => void) => {
        if (handlers.get(signal) === handler) handlers.delete(signal);
      }),
    },
  };
}

describe("runGitHubConnectionReconcileCli", () => {
  it("runs one bounded cycle with numeric environment settings and prints only its safe summary", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const runtime = signals();
    const runCycle = vi.fn().mockResolvedValue(summary);

    await expect(runGitHubConnectionReconcileCli({
      environment: {
        GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "12",
        GITHUB_CONNECTION_MAX_INSTALLATIONS: "3",
        GITHUB_CONNECTION_TIME_BUDGET_MS: "120000",
      },
      randomUUID: () => executionId,
      runCycle,
      stdout: (value) => output.push(value),
      stderr: (value) => errors.push(value),
      signals: runtime.runtime,
    })).resolves.toBe(0);

    expect(runCycle).toHaveBeenCalledOnce();
    expect(runCycle).toHaveBeenCalledWith({
      executionId,
      maximumWebhookDeliveries: 12,
      maximumInstallations: 3,
      timeBudgetMs: 120_000,
      signal: expect.any(AbortSignal),
    });
    expect(output).toEqual([`${JSON.stringify(summary)}\n`]);
    expect(errors).toEqual([]);
    expect(runtime.runtime.once).toHaveBeenCalledTimes(2);
    expect(runtime.runtime.once).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(runtime.runtime.once).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(runtime.handlers.size).toBe(0);
  });

  it("uses finite defaults when bounded settings are omitted", async () => {
    const runCycle = vi.fn().mockResolvedValue(summary);

    await expect(runGitHubConnectionReconcileCli({
      environment: {},
      randomUUID: () => executionId,
      runCycle,
      stdout: vi.fn(),
      stderr: vi.fn(),
      signals: signals().runtime,
    })).resolves.toBe(0);

    expect(runCycle).toHaveBeenCalledWith(expect.objectContaining({
      maximumWebhookDeliveries: 25,
      maximumInstallations: 10,
      timeBudgetMs: 180_000,
    }));
  });

  it.each([
    ["GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES", "0"],
    ["GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES", "101"],
    ["GITHUB_CONNECTION_MAX_INSTALLATIONS", "0"],
    ["GITHUB_CONNECTION_MAX_INSTALLATIONS", "101"],
    ["GITHUB_CONNECTION_TIME_BUDGET_MS", "0"],
    ["GITHUB_CONNECTION_TIME_BUDGET_MS", "240001"],
    ["GITHUB_CONNECTION_MAX_INSTALLATIONS", "1.5"],
    ["GITHUB_CONNECTION_MAX_INSTALLATIONS", "01"],
  ])("rejects unsafe %s=%s without starting a cycle", async (name, value) => {
    const runCycle = vi.fn();
    const errors: string[] = [];

    await expect(runGitHubConnectionReconcileCli({
      environment: { [name]: value },
      randomUUID: () => executionId,
      runCycle,
      stdout: vi.fn(),
      stderr: (message) => errors.push(message),
      signals: signals().runtime,
    })).resolves.toBe(1);

    expect(runCycle).not.toHaveBeenCalled();
    expect(errors).toEqual(["GitHub connection reconciliation failed\n"]);
  });

  it("aborts the one running cycle on either one-shot process signal and emits no abort reason", async () => {
    for (const signalName of ["SIGTERM", "SIGINT"] as const) {
      const runtime = signals();
      const privateDetail = crypto.randomUUID();
      const errors: string[] = [];
      const runCycle = vi.fn().mockImplementation(async (input: { signal?: AbortSignal }) => {
        runtime.handlers.get(signalName)?.();
        expect(input.signal?.aborted).toBe(true);
        expect(String(input.signal?.reason)).not.toContain(privateDetail);
        throw new Error(privateDetail);
      });

      await expect(runGitHubConnectionReconcileCli({
        environment: {},
        randomUUID: () => executionId,
        runCycle,
        stdout: vi.fn(),
        stderr: (message) => errors.push(message),
        signals: runtime.runtime,
      })).resolves.toBe(1);

      expect(errors).toEqual(["GitHub connection reconciliation failed\n"]);
      expect(runtime.handlers.size).toBe(0);
    }
  });

  it("rejects a malformed cycle result instead of printing provider or credential data", async () => {
    const privateDetail = crypto.randomUUID();
    const output: string[] = [];
    const errors: string[] = [];

    await expect(runGitHubConnectionReconcileCli({
      environment: {},
      randomUUID: () => executionId,
      runCycle: vi.fn().mockResolvedValue({ ...summary, providerBody: privateDetail }),
      stdout: (message) => output.push(message),
      stderr: (message) => errors.push(message),
      signals: signals().runtime,
    })).resolves.toBe(1);

    expect(output).toEqual([]);
    expect(errors).toEqual(["GitHub connection reconciliation failed\n"]);
    expect(JSON.stringify({ output, errors })).not.toContain(privateDetail);
  });

  it("is a finite entry point with no polling timer", async () => {
    const source = await readFile(new URL("./github-connection-reconcile.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/setInterval|while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;/);
    expect(source).toMatch(/process\.exitCode/);
  });

  it("is exposed as the one-shot production package command", async () => {
    const packageDocument = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageDocument.scripts?.["github:reconcile-connections"]).toBe(
      "node --conditions=react-server --import=tsx scripts/github-connection-reconcile.ts",
    );
  });
});
