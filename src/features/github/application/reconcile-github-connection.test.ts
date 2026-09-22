// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { READ_PERMISSIONS } from "./github-app-auth";
import type { InstallationSnapshot } from "./github-installation-api";
import {
  reconcileGitHubConnection,
  type ClaimedGitHubConnectionReconciliation,
  type ReconcileGitHubConnectionDependencies,
} from "./reconcile-github-connection";

const CLAIM: ClaimedGitHubConnectionReconciliation = {
  runId: "11111111-1111-4111-8111-111111111111",
  installationUuid: "22222222-2222-4222-8222-222222222222",
  providerInstallationId: 77,
  organisationId: "33333333-3333-4333-8333-333333333333",
  previousHealth: "healthy",
  consecutiveFailures: 0,
  expectedAccount: { id: 99, login: "Adtecher", type: "Organization" },
};

function repository(id: number, name = `repo-${id}`) {
  return {
    id, owner: "Adtecher", name, fullName: `Adtecher/${name}`,
    htmlUrl: `https://github.com/Adtecher/${name}`, visibility: "private" as const,
    archived: false, defaultBranch: "main",
  };
}

function snapshot(overrides: Partial<InstallationSnapshot> = {}): InstallationSnapshot {
  return {
    installationId: 77,
    account: { id: 99, login: "Adtecher", type: "Organization" },
    repositorySelection: "selected",
    permissions: { ...READ_PERMISSIONS },
    suspendedAt: null,
    repositories: [repository(101), repository(102)],
    ...overrides,
  };
}

function deps(overrides: Partial<ReconcileGitHubConnectionDependencies> = {}) {
  const readSnapshot = vi.fn().mockResolvedValue(snapshot());
  const provideCredentials = vi.fn().mockResolvedValue({ appJwt: "test-app-jwt", installationToken: "test-installation-token" });
  const finalize = vi.fn().mockResolvedValue("none");
  const loadStoredRepositories = vi.fn().mockResolvedValue([
    { providerId: 101, fullName: "Adtecher/repo-101" },
    { providerId: 102, fullName: "Adtecher/repo-102" },
  ]);
  return {
    readSnapshot, provideCredentials, finalize, loadStoredRepositories,
    now: new Date("2026-09-18T12:00:00.000Z"),
    ...overrides,
  } as ReconcileGitHubConnectionDependencies & {
    readSnapshot: ReturnType<typeof vi.fn>;
    provideCredentials: ReturnType<typeof vi.fn>;
    finalize: ReturnType<typeof vi.fn>;
    loadStoredRepositories: ReturnType<typeof vi.fn>;
  };
}

describe("reconcileGitHubConnection", () => {
  it("finalises a matching connection once with the canonical snapshot", async () => {
    const dependencies = deps();
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision).toMatchObject({ health: "healthy", openIncident: false, closeIncident: false });
    expect(result.repositoriesSeen).toBe(2);
    expect(dependencies.finalize).toHaveBeenCalledTimes(1);
    expect(dependencies.finalize).toHaveBeenCalledWith({
      runId: CLAIM.runId,
      outcome: "success",
      diagnostic: null,
      nextAttemptAt: null,
      snapshot: [repository(101), repository(102)],
    });
    expect(JSON.stringify(dependencies.finalize.mock.calls)).not.toContain("test-app-jwt");
    expect(JSON.stringify(dependencies.finalize.mock.calls)).not.toContain("test-installation-token");
  });

  it("treats a renamed repository as success with the new canonical name", async () => {
    const dependencies = deps({
      readSnapshot: vi.fn().mockResolvedValue(snapshot({ repositories: [repository(101, "renamed"), repository(102)] })),
    });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision.health).toBe("healthy");
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "success",
      snapshot: expect.arrayContaining([expect.objectContaining({ id: 101, fullName: "Adtecher/renamed" })]),
    }));
  });

  it("reports partial loss when a stored repository disappears", async () => {
    const dependencies = deps({
      readSnapshot: vi.fn().mockResolvedValue(snapshot({ repositories: [repository(101)] })),
    });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision).toMatchObject({ health: "partially_unavailable", openIncident: true });
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "partial",
      diagnostic: "repository_unavailable",
      snapshot: [repository(101)],
    }));
  });

  it.each([
    ["suspended installation", snapshot({ suspendedAt: "2026-09-01T00:00:00.000Z" }), "installation_suspended"],
    ["changed permissions", snapshot({ permissions: { ...READ_PERMISSIONS, contents: "read" } }), "permission_mismatch"],
    ["weakened permission", snapshot({ permissions: { ...READ_PERMISSIONS, administration: "write" } }), "permission_mismatch"],
    ["wrong account", snapshot({ account: { id: 100, login: "Other-Co", type: "Organization" } }), "account_mismatch"],
    ["renamed account", snapshot({ account: { id: 99, login: "Renamed-Co", type: "Organization" } }), "account_mismatch"],
  ])("requires Owner action for %s with a diagnostic and no snapshot", async (_label, snap, diagnostic) => {
    const dependencies = deps({ readSnapshot: vi.fn().mockResolvedValue(snap) });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision).toMatchObject({ health: "owner_action_required", openIncident: true, diagnostic });
    expect(dependencies.finalize).toHaveBeenCalledWith({
      runId: CLAIM.runId,
      outcome: "action_required",
      diagnostic,
      nextAttemptAt: null,
      snapshot: null,
    });
  });

  it.each([
    ["revoked installation", "not_found", "installation_revoked", "disconnected"],
    ["rate-limited provider", "rate_limited", "provider_rate_limited", "retrying"],
    ["provider outage", "server", "provider_temporary_failure", "retrying"],
    ["broken network", "network", "provider_temporary_failure", "retrying"],
    ["malformed provider data", "invalid", "invalid_provider_response", "retrying"],
    ["denied credentials", "unauthorized", "permission_mismatch", "owner_action_required"],
  ])("maps %s to a safe outcome", async (_label, kind, diagnostic, health) => {
    const failure = new Error("GitHub installation API failed");
    (failure as { kind?: string }).kind = kind;
    const dependencies = deps({ readSnapshot: vi.fn().mockRejectedValue(failure) });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision.health).toBe(health);
    expect(dependencies.finalize).toHaveBeenCalledTimes(1);
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({ diagnostic, snapshot: null }));
  });

  it("maps a credential-provider denial before reading a snapshot", async () => {
    const failure = Object.assign(new Error("GitHub installation token failed"), { kind: "forbidden" });
    const dependencies = deps({ provideCredentials: vi.fn().mockRejectedValue(failure) });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision).toMatchObject({
      health: "owner_action_required",
      diagnostic: "permission_mismatch",
      openIncident: true,
    });
    expect(dependencies.readSnapshot).not.toHaveBeenCalled();
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "action_required",
      diagnostic: "permission_mismatch",
      snapshot: null,
    }));
  });

  it("marks an unshaped failure as internal without provider content", async () => {
    const dependencies = deps({ readSnapshot: vi.fn().mockRejectedValue(new TypeError("bug")) });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision).toMatchObject({ health: "retrying", diagnostic: "internal_failure" });
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({ diagnostic: "internal_failure", snapshot: null }));
  });

  it("honours the provider retry time on rate limits", async () => {
    const failure = new Error("GitHub installation API failed") as Error & { kind?: string; retryAt?: string };
    failure.kind = "rate_limited";
    failure.retryAt = "2026-09-18T12:30:00.000Z";
    const dependencies = deps({ readSnapshot: vi.fn().mockRejectedValue(failure) });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision.retryAt).toBe("2026-09-18T12:30:00.000Z");
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({ nextAttemptAt: "2026-09-18T12:30:00.000Z" }));
  });

  it("preserves Retry-After metadata from lazy installation-token failures", async () => {
    const failure = Object.assign(new Error("GitHub installation token failed"), {
      kind: "rate_limited",
      retryAfterSeconds: 3_600,
    });
    const dependencies = deps({ provideCredentials: vi.fn().mockRejectedValue(failure) });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision.retryAt).toBe("2026-09-18T13:00:00.000Z");
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({
      nextAttemptAt: "2026-09-18T13:00:00.000Z",
    }));
  });

  it("falls back to Retry-After when the reset timestamp is outside the Date range", async () => {
    const failure = Object.assign(new Error("GitHub installation token failed"), {
      kind: "rate_limited",
      resetAtEpochSeconds: Number.MAX_SAFE_INTEGER,
      retryAfterSeconds: 120,
    });
    const dependencies = deps({ provideCredentials: vi.fn().mockRejectedValue(failure) });
    const result = await reconcileGitHubConnection(dependencies, CLAIM);
    expect(result.decision.retryAt).toBe("2026-09-18T12:02:00.000Z");
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({
      nextAttemptAt: "2026-09-18T12:02:00.000Z",
    }));
  });

  it("closes the incident when a partial loss recovers", async () => {
    const dependencies = deps();
    const result = await reconcileGitHubConnection(dependencies, { ...CLAIM, previousHealth: "partially_unavailable" });
    expect(result.decision).toMatchObject({ health: "healthy", closeIncident: true });
  });

  it("uses the incident ledger recovery signal after a disconnected installation is reconnected", async () => {
    const dependencies = deps({ finalize: vi.fn().mockResolvedValue("recovered") });
    const result = await reconcileGitHubConnection(dependencies, {
      ...CLAIM,
      previousHealth: "retrying",
      consecutiveFailures: 0,
    });

    expect(result.decision).toMatchObject({ health: "healthy", closeIncident: true });
  });
});

describe("module boundaries", () => {
  it("never imports collection, rules, materialisation, Evidence, Finding or Task modules", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./reconcile-github-connection.ts", import.meta.url), "utf8");
    for (const forbidden of [
      "run-collection",
      "domain/rules",
      "materialise-approved-observations",
      "features/evidence",
      "features/monitoring",
      "features/tasks",
      "supabase/service",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
