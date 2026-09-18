// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  exitCodeForCycle,
  parseCycleEnvironment,
  summariseCycleForLog,
} from "./github-connection-reconcile";

describe("github-connection-reconcile entry point", () => {
  it("applies bounded defaults for missing cycle configuration", () => {
    expect(parseCycleEnvironment({})).toEqual({
      maximumWebhookDeliveries: 20,
      maximumInstallations: 10,
      timeBudgetMs: 240_000,
    });
  });

  it("accepts explicit values inside the tested bounds", () => {
    expect(parseCycleEnvironment({
      GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "5",
      GITHUB_CONNECTION_MAX_INSTALLATIONS: "3",
      GITHUB_CONNECTION_TIME_BUDGET_MS: "30000",
    })).toEqual({ maximumWebhookDeliveries: 5, maximumInstallations: 3, timeBudgetMs: 30000 });
  });

  it.each([
    ["zero deliveries", { GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "0" }],
    ["oversized deliveries", { GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "101" }],
    ["fractional installations", { GITHUB_CONNECTION_MAX_INSTALLATIONS: "2.5" }],
    ["negative budget", { GITHUB_CONNECTION_TIME_BUDGET_MS: "-1" }],
    ["oversized budget", { GITHUB_CONNECTION_TIME_BUDGET_MS: "300001" }],
    ["non-numeric budget", { GITHUB_CONNECTION_TIME_BUDGET_MS: "soon" }],
  ])("rejects %s without starting work", (_label, env) => {
    expect(() => parseCycleEnvironment(env)).toThrow("GitHub connection cycle configuration is invalid");
  });

  it("summarises only counts and identifiers for logs", () => {
    const summary = summariseCycleForLog("11111111-1111-4111-8111-111111111111", {
      executionId: "11111111-1111-4111-8111-111111111111",
      webhookDeliveriesClaimed: 2,
      installationsClaimed: 1,
      healthy: 1,
      retrying: 0,
      actionRequired: 0,
      recovered: 0,
      ownershipLost: 0,
    });
    expect(summary).toContain("11111111-1111-4111-8111-111111111111");
    expect(summary).toContain("healthy=1");
    expect(summary).not.toContain("secret");
  });

  it("maps clean, interrupted and failed cycles to exit codes", () => {
    expect(exitCodeForCycle(null)).toBe(0);
    expect(exitCodeForCycle(new Error("GitHub connection cycle exceeded its time budget"))).toBe(1);
    expect(exitCodeForCycle(new Error("GitHub connection cycle was aborted"))).toBe(1);
    expect(exitCodeForCycle(new Error("anything else"))).toBe(1);
  });
});
