import { describe, expect, it } from "vitest";

import {
  decideConnectionReconciliation,
  type GitHubConnectionDiagnostic,
  type GitHubConnectionHealth,
} from "./connection-health";

const NOW = "2026-09-18T12:00:00.000Z";

function decide(input: {
  previousHealth: GitHubConnectionHealth;
  consecutiveFailures: number;
  outcome: "success" | "partial" | "temporary_failure" | "action_required" | "disconnected";
  diagnostic?: GitHubConnectionDiagnostic | null;
  providerRetryAt?: string | null;
}) {
  return decideConnectionReconciliation({ now: NOW, diagnostic: null, ...input });
}

describe("decideConnectionReconciliation", () => {
  it("keeps a verified healthy connection quiet", () => {
    expect(decide({ previousHealth: "healthy", consecutiveFailures: 0, outcome: "success" })).toEqual({
      health: "healthy",
      retryAt: null,
      openIncident: false,
      closeIncident: false,
      diagnostic: null,
    });
  });

  it("retries temporary failures after 1, 5 and 15 minutes without an incident", () => {
    expect(decide({ previousHealth: "healthy", consecutiveFailures: 0, outcome: "temporary_failure" })).toMatchObject({
      health: "retrying",
      retryAt: "2026-09-18T12:01:00.000Z",
      openIncident: false,
      closeIncident: false,
    });
    expect(decide({ previousHealth: "retrying", consecutiveFailures: 1, outcome: "temporary_failure" })).toMatchObject({
      health: "retrying",
      retryAt: "2026-09-18T12:05:00.000Z",
      openIncident: false,
    });
    expect(decide({ previousHealth: "retrying", consecutiveFailures: 4, outcome: "temporary_failure" })).toMatchObject({
      health: "retrying",
      retryAt: "2026-09-18T12:15:00.000Z",
      openIncident: true,
    });
  });

  it("opens one incident on the third consecutive temporary failure", () => {
    const decision = decide({ previousHealth: "retrying", consecutiveFailures: 2, outcome: "temporary_failure" });
    expect(decision).toMatchObject({ health: "retrying", retryAt: "2026-09-18T12:15:00.000Z", openIncident: true, closeIncident: false });
  });

  it("lets a later provider rate-limit time win over the policy delay", () => {
    const decision = decide({
      previousHealth: "healthy",
      consecutiveFailures: 0,
      outcome: "temporary_failure",
      diagnostic: "provider_rate_limited",
      providerRetryAt: "2026-09-18T12:30:00.000Z",
    });
    expect(decision.retryAt).toBe("2026-09-18T12:30:00.000Z");
    expect(decision.diagnostic).toBe("provider_rate_limited");
  });

  it("keeps the policy delay when the provider time is earlier", () => {
    const decision = decide({
      previousHealth: "healthy",
      consecutiveFailures: 0,
      outcome: "temporary_failure",
      diagnostic: "provider_rate_limited",
      providerRetryAt: "2026-09-18T12:00:30.000Z",
    });
    expect(decision.retryAt).toBe("2026-09-18T12:01:00.000Z");
  });

  it("marks partial repository loss immediately with an incident", () => {
    expect(decide({
      previousHealth: "healthy",
      consecutiveFailures: 0,
      outcome: "partial",
      diagnostic: "repository_unavailable",
    })).toMatchObject({
      health: "partially_unavailable",
      retryAt: null,
      openIncident: true,
      closeIncident: false,
      diagnostic: "repository_unavailable",
    });
  });

  it("keeps projecting an unresolved partial incident so failed notice work can retry", () => {
    expect(decide({
      previousHealth: "partially_unavailable",
      consecutiveFailures: 0,
      outcome: "partial",
      diagnostic: "repository_unavailable",
    })).toMatchObject({ openIncident: true, closeIncident: false });
  });

  it.each([
    ["permission mismatch", "permission_mismatch"],
    ["account mismatch", "account_mismatch"],
    ["suspension", "installation_suspended"],
  ] as const)("requires Owner action immediately on %s", (_label, diagnostic) => {
    expect(decide({
      previousHealth: "healthy",
      consecutiveFailures: 0,
      outcome: "action_required",
      diagnostic,
    })).toMatchObject({
      health: "owner_action_required",
      retryAt: null,
      openIncident: true,
      closeIncident: false,
    });
  });

  it("marks revocation as disconnected with an immediate incident", () => {
    expect(decide({
      previousHealth: "owner_action_required",
      consecutiveFailures: 1,
      outcome: "disconnected",
      diagnostic: "installation_revoked",
    })).toMatchObject({
      health: "disconnected",
      retryAt: null,
      openIncident: true,
      closeIncident: false,
    });
  });

  it.each([
    ["partial scope loss", "partially_unavailable" as GitHubConnectionHealth, 0],
    ["required Owner action", "owner_action_required" as GitHubConnectionHealth, 1],
    ["a retrying incident", "retrying" as GitHubConnectionHealth, 3],
  ])("closes the incident on successful recovery from %s", (_label, previousHealth, consecutiveFailures) => {
    expect(decide({ previousHealth, consecutiveFailures, outcome: "success" })).toMatchObject({
      health: "healthy",
      retryAt: null,
      openIncident: false,
      closeIncident: true,
    });
  });

  it("rejects an invalid timestamp without deciding", () => {
    expect(() => decideConnectionReconciliation({
      previousHealth: "healthy",
      consecutiveFailures: 0,
      outcome: "success",
      diagnostic: null,
      now: "not-a-timestamp",
    })).toThrow();
  });
});
