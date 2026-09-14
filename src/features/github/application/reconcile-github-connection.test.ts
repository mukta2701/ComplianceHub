// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { GitHubInstallationTokenError, READ_PERMISSIONS } from "./github-app-auth";
import { GitHubInstallationApiError, type InstallationSnapshot } from "./github-installation-api";
import {
  reconcileGitHubConnection,
  type ClaimedGitHubConnectionReconciliation,
  type ReconcileGitHubConnectionDependencies,
} from "./reconcile-github-connection";

const claim: ClaimedGitHubConnectionReconciliation = {
  runId: "11111111-1111-4111-8111-111111111111",
  workerId: "22222222-2222-4222-8222-222222222222",
  organisationId: "33333333-3333-4333-8333-333333333333",
  installationId: "44444444-4444-4444-8444-444444444444",
  providerInstallationId: 77,
  account: { id: 99, login: "Adtecher", type: "Organization" },
  repositorySelection: "selected",
  permissions: { ...READ_PERMISSIONS },
  selectedRepositoryIds: [101, 102],
  previousHealth: "healthy",
  consecutiveFailures: 0,
  attemptedAt: "2026-09-14T12:00:00.000Z",
};

function repository(id: number, name = `repo-${id}`) {
  return {
    id,
    owner: "Adtecher",
    name,
    fullName: `Adtecher/${name}`,
    htmlUrl: `https://github.com/Adtecher/${name}`,
    visibility: "private" as const,
    archived: false,
    defaultBranch: "main",
  };
}

function snapshot(overrides: Partial<InstallationSnapshot> = {}): InstallationSnapshot {
  return {
    installationId: 77,
    account: { id: 99, login: "Adtecher", type: "Organization" },
    repositorySelection: "selected",
    permissions: READ_PERMISSIONS,
    suspendedAt: null,
    repositories: [repository(101), repository(102), repository(103)],
    ...overrides,
  };
}

function dependencies(providerSnapshot: InstallationSnapshot = snapshot()): ReconcileGitHubConnectionDependencies & {
  finalize: ReturnType<typeof vi.fn>;
  readSnapshot: ReturnType<typeof vi.fn>;
} {
  return {
    createAppJwt: vi.fn().mockResolvedValue(["fictional", "app", "credential"].join("-")),
    createInstallationToken: vi.fn().mockResolvedValue({
      token: ["fictional", "installation", "credential"].join("-"),
      expiresAt: "2026-09-14T13:00:00.000Z",
    }),
    readSnapshot: vi.fn().mockResolvedValue(providerSnapshot),
    finalize: vi.fn().mockResolvedValue("none"),
    now: () => new Date("2026-09-14T12:00:00.000Z"),
  };
}

describe("reconcileGitHubConnection", () => {
  it("finalizes a matching installation once with a canonical safe snapshot", async () => {
    const deps = dependencies(snapshot({ repositories: [repository(103), repository(101), repository(102)] }));
    const result = await reconcileGitHubConnection(deps, claim);

    expect(result).toMatchObject({ outcome: "success", diagnostic: null, incidentTransition: "none" });
    expect(deps.finalize).toHaveBeenCalledOnce();
    expect(deps.finalize).toHaveBeenCalledWith(claim, {
      outcome: "success",
      diagnostic: null,
      nextAttemptAt: "2026-09-15T12:00:00.000Z",
      repositorySnapshot: [repository(101), repository(102), repository(103)],
    });
    const persisted = JSON.stringify(deps.finalize.mock.calls);
    expect(persisted).not.toContain("fictional-app-credential");
    expect(persisted).not.toContain("fictional-installation-credential");
  });

  it("marks only selected provider scope loss as partially unavailable", async () => {
    const deps = dependencies(snapshot({ repositories: [repository(101), repository(103)] }));

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({
      outcome: "partial",
      diagnostic: "repository_unavailable",
    });
    expect(deps.finalize).toHaveBeenCalledOnce();
    expect(deps.finalize).toHaveBeenCalledWith(claim, expect.objectContaining({
      outcome: "partial",
      diagnostic: "repository_unavailable",
      repositorySnapshot: [repository(101), repository(103)],
    }));
  });

  it("treats a repository rename as refreshed metadata because stable provider identity remains", async () => {
    const deps = dependencies(snapshot({ repositories: [repository(101, "renamed"), repository(102)] }));

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({ outcome: "success" });
    expect(deps.finalize).toHaveBeenCalledWith(claim, expect.objectContaining({
      outcome: "success",
      repositorySnapshot: [repository(101, "renamed"), repository(102)],
    }));
  });

  it.each([
    [snapshot({ suspendedAt: "2026-09-14T11:00:00.000Z" }), "installation_suspended"],
    [snapshot({ account: { id: 100, login: "Other", type: "Organization" } }), "account_mismatch"],
  ] as const)("fails closed on serious provider state with %s", async (providerSnapshot, diagnostic) => {
    const deps = dependencies(providerSnapshot);
    const result = await reconcileGitHubConnection(deps, claim);

    expect(result).toMatchObject({ outcome: "action_required", diagnostic });
    expect(deps.finalize).toHaveBeenCalledOnce();
    expect(deps.finalize).toHaveBeenCalledWith(claim, {
      outcome: "action_required",
      diagnostic,
      nextAttemptAt: null,
      repositorySnapshot: [],
    });
  });

  it.each([
    [new GitHubInstallationApiError("permission_mismatch"), "action_required", "permission_mismatch", null],
    [new GitHubInstallationApiError("authentication_failed"), "action_required", "permission_mismatch", null],
    [new GitHubInstallationApiError("not_found"), "disconnected", "installation_revoked", null],
    [new GitHubInstallationApiError("rate_limited", "2026-09-14T12:20:00.000Z"), "temporary_failure", "provider_rate_limited", "2026-09-14T12:20:00.000Z"],
    [new GitHubInstallationApiError("timeout"), "temporary_failure", "provider_temporary_failure", "2026-09-14T12:01:00.000Z"],
    [new GitHubInstallationApiError("provider_failure"), "temporary_failure", "provider_temporary_failure", "2026-09-14T12:01:00.000Z"],
    [new GitHubInstallationApiError("invalid_response"), "temporary_failure", "invalid_provider_response", "2026-09-14T12:01:00.000Z"],
  ] as const)("maps provider failure %s and finalizes exactly once", async (error, outcome, diagnostic, nextAttemptAt) => {
    const deps = dependencies();
    deps.readSnapshot.mockRejectedValue(error);

    const result = await reconcileGitHubConnection(deps, claim);

    expect(result).toMatchObject({ outcome, diagnostic });
    expect(deps.finalize).toHaveBeenCalledOnce();
    expect(deps.finalize).toHaveBeenCalledWith(claim, {
      outcome,
      diagnostic,
      nextAttemptAt,
      repositorySnapshot: [],
    });
  });

  it("maps an unexpected credential failure to one safe internal finalization", async () => {
    const deps = dependencies();
    const providerDetail = crypto.randomUUID();
    vi.mocked(deps.createAppJwt).mockRejectedValue(new Error(providerDetail));

    const result = await reconcileGitHubConnection(deps, claim);

    expect(result).toMatchObject({ outcome: "temporary_failure", diagnostic: "internal_failure" });
    expect(JSON.stringify(result)).not.toContain(providerDetail);
    expect(JSON.stringify(deps.finalize.mock.calls)).not.toContain(providerDetail);
    expect(deps.finalize).toHaveBeenCalledOnce();
  });

  it.each([
    [new GitHubInstallationTokenError("authentication_failed"), "action_required", "permission_mismatch"],
    [new GitHubInstallationTokenError("not_found"), "disconnected", "installation_revoked"],
    [new GitHubInstallationTokenError("provider_failure"), "temporary_failure", "provider_temporary_failure"],
    [new GitHubInstallationTokenError("timeout"), "temporary_failure", "provider_temporary_failure"],
  ] as const)("maps inventory-token failure %s to a safe finalization", async (error, outcome, diagnostic) => {
    const deps = dependencies();
    vi.mocked(deps.createInstallationToken).mockRejectedValue(error);

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({ outcome, diagnostic });
    expect(deps.readSnapshot).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledOnce();
  });

  it("refuses an expired or overlong installation credential before provider reads and still finalizes once", async () => {
    for (const expiresAt of ["2026-09-14T12:00:00.000Z", "2026-09-14T13:00:00.001Z", "not-a-date"]) {
      const deps = dependencies();
      vi.mocked(deps.createInstallationToken).mockResolvedValue({
        token: ["unit", "fixture", "short", "authorization"].join(":"),
        expiresAt,
      });

      await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({ diagnostic: "internal_failure" });
      expect(deps.readSnapshot).not.toHaveBeenCalled();
      expect(deps.finalize).toHaveBeenCalledOnce();
    }
  });

  it("does not import collection, interpretation, materialisation, or compliance-outcome modules", async () => {
    const source = await readFile(new URL("./reconcile-github-connection.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);

    expect(imports).not.toEqual(expect.arrayContaining([
      "./run-collection",
      "../domain/rules",
      "./materialise-approved-observations",
    ]));
    expect(source).not.toMatch(/features\/(?:evidence|findings|tasks)|domain\/(?:observation|rules)/i);
  });
});
