import { describe, expect, it } from "vitest";

import {
  decideConnectionReconciliation,
  type GitHubConnectionDiagnostic,
  type GitHubConnectionHealth,
} from "./connection-health";

const NOW = "2026-09-14T10:00:00.000Z";

function decision(overrides: {
  previousHealth?: GitHubConnectionHealth;
  consecutiveFailures?: number;
  outcome?: "success" | "partial" | "temporary_failure" | "action_required" | "disconnected";
  diagnostic?: GitHubConnectionDiagnostic | null;
  now?: string;
  providerRetryAt?: string | null;
} = {}) {
  return decideConnectionReconciliation({
    previousHealth: "healthy",
    consecutiveFailures: 0,
    outcome: "success",
    diagnostic: null,
    now: NOW,
    ...overrides,
  });
}

describe("GitHub connection reconciliation decisions", () => {
  it.each([
    ["first successful verification", "healthy", false],
    ["quiet temporary retry", "retrying", false],
    ["persistent temporary failure", "retrying", true],
    ["partial repository loss", "partially_unavailable", true],
    ["permission mismatch", "owner_action_required", true],
    ["installation suspension", "owner_action_required", true],
    ["installation revocation", "disconnected", true],
    ["successful incident recovery", "healthy", false],
  ] as const)("classifies %s without borrowing compliance status", (
    scenario,
    expectedHealth,
    expectedIncidentOpen,
  ) => {
    const inputs = {
      "first successful verification": {},
      "quiet temporary retry": {
        outcome: "temporary_failure" as const,
        diagnostic: "provider_temporary_failure" as const,
        consecutiveFailures: 1,
      },
      "persistent temporary failure": {
        outcome: "temporary_failure" as const,
        diagnostic: "internal_failure" as const,
        consecutiveFailures: 2,
      },
      "partial repository loss": {
        outcome: "partial" as const,
        diagnostic: "repository_unavailable" as const,
      },
      "permission mismatch": {
        outcome: "action_required" as const,
        diagnostic: "permission_mismatch" as const,
      },
      "installation suspension": {
        outcome: "action_required" as const,
        diagnostic: "installation_suspended" as const,
      },
      "installation revocation": {
        outcome: "disconnected" as const,
        diagnostic: "installation_revoked" as const,
      },
      "successful incident recovery": {
        outcome: "success" as const,
        previousHealth: "owner_action_required" as const,
        consecutiveFailures: 4,
      },
    }[scenario];

    const result = decision(inputs);
    expect(result.health).toBe(expectedHealth);
    expect(result.openIncident).toBe(expectedIncidentOpen);
    expect(result.closeIncident).toBe(scenario === "successful incident recovery");
  });

  it.each([
    [0, "2026-09-14T10:01:00.000Z"],
    [1, "2026-09-14T10:05:00.000Z"],
    [2, "2026-09-14T10:15:00.000Z"],
    [7, "2026-09-14T10:15:00.000Z"],
  ])("uses the bounded retry delay after %i previous failures", (consecutiveFailures, retryAt) => {
    expect(decision({
      outcome: "temporary_failure",
      diagnostic: "provider_temporary_failure",
      consecutiveFailures,
    }).retryAt).toBe(retryAt);
  });

  it("uses a later provider rate-limit reset without shortening the fixed backoff", () => {
    expect(decision({
      outcome: "temporary_failure",
      diagnostic: "provider_rate_limited",
      consecutiveFailures: 0,
      providerRetryAt: "2026-09-14T10:11:00.000Z",
    }).retryAt).toBe("2026-09-14T10:11:00.000Z");

    expect(decision({
      outcome: "temporary_failure",
      diagnostic: "provider_rate_limited",
      consecutiveFailures: 1,
      providerRetryAt: "2026-09-14T10:02:00.000Z",
    }).retryAt).toBe("2026-09-14T10:05:00.000Z");
  });

  it("rejects invalid time and failure-count inputs instead of manufacturing healthy state", () => {
    expect(() => decision({ now: "not-a-time" })).toThrow("valid reconciliation time");
    expect(() => decision({ consecutiveFailures: -1 })).toThrow("non-negative integer");
    expect(() => decision({
      outcome: "temporary_failure",
      diagnostic: "provider_rate_limited",
      providerRetryAt: "not-a-time",
    })).toThrow("valid provider retry time");
  });

  it.each([
    ["partial", "provider_temporary_failure"],
    ["temporary_failure", "installation_suspended"],
    ["action_required", "repository_unavailable"],
    ["disconnected", "account_mismatch"],
  ] as const)("rejects the %s outcome with the unrelated %s diagnostic", (outcome, diagnostic) => {
    expect(() => decision({ outcome, diagnostic })).toThrow("diagnostic does not match outcome");
  });

  it("closes only a temporary-failure incident that had reached its threshold", () => {
    expect(decision({
      previousHealth: "retrying",
      consecutiveFailures: 2,
    }).closeIncident).toBe(false);
    expect(decision({
      previousHealth: "retrying",
      consecutiveFailures: 3,
    }).closeIncident).toBe(true);
  });

  it("keeps a serious incident open when a later check is still temporarily unavailable", () => {
    expect(decision({
      previousHealth: "partially_unavailable",
      consecutiveFailures: 1,
      outcome: "temporary_failure",
      diagnostic: "provider_temporary_failure",
    })).toMatchObject({
      health: "retrying",
      openIncident: true,
      closeIncident: false,
    });
  });
});
