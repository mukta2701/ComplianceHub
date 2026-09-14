// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createInstallationInventoryToken,
  GitHubInstallationTokenError,
  READ_PERMISSIONS,
} from "./github-app-auth";
import {
  GitHubInstallationApiError,
  readInstallationMetadata,
  readInstallationRepositories,
  type InstallationMetadata,
  type InstallationSnapshot,
} from "./github-installation-api";
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

function metadata(providerSnapshot: InstallationSnapshot = snapshot()): InstallationMetadata {
  return {
    installationId: providerSnapshot.installationId,
    account: providerSnapshot.account,
    repositorySelection: providerSnapshot.repositorySelection,
    permissions: providerSnapshot.permissions,
    suspendedAt: providerSnapshot.suspendedAt,
  };
}

function dependencies(providerSnapshot: InstallationSnapshot = snapshot()): ReconcileGitHubConnectionDependencies & {
  finalize: ReturnType<typeof vi.fn>;
  readMetadata: ReturnType<typeof vi.fn>;
  readRepositories: ReturnType<typeof vi.fn>;
} {
  return {
    createAppJwt: vi.fn().mockResolvedValue(["fictional", "app", "credential"].join("-")),
    createInstallationToken: vi.fn().mockResolvedValue({
      token: ["fictional", "installation", "credential"].join("-"),
      expiresAt: "2026-09-14T13:00:00.000Z",
    }),
    readMetadata: vi.fn().mockResolvedValue(metadata(providerSnapshot)),
    readRepositories: vi.fn().mockResolvedValue(providerSnapshot.repositories),
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
    expect(deps.createInstallationToken).not.toHaveBeenCalled();
    expect(deps.readRepositories).not.toHaveBeenCalled();
  });

  it("classifies changed permissions from metadata before requesting an installation token", async () => {
    const deps = dependencies();
    deps.readMetadata.mockResolvedValue({
      ...metadata(),
      permissions: { ...READ_PERMISSIONS, contents: "read" },
    });

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({
      outcome: "action_required",
      diagnostic: "permission_mismatch",
    });
    expect(deps.createInstallationToken).not.toHaveBeenCalled();
    expect(deps.readRepositories).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledOnce();
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
    deps.readMetadata.mockRejectedValue(error);

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
    [new GitHubInstallationTokenError("invalid_response"), "temporary_failure", "invalid_provider_response"],
    [new GitHubInstallationTokenError("provider_failure"), "temporary_failure", "provider_temporary_failure"],
    [new GitHubInstallationTokenError("timeout"), "temporary_failure", "provider_temporary_failure"],
  ] as const)("maps inventory-token failure %s to a safe finalization", async (error, outcome, diagnostic) => {
    const deps = dependencies();
    vi.mocked(deps.createInstallationToken).mockRejectedValue(error);

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({ outcome, diagnostic });
    expect(deps.readRepositories).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledOnce();
  });

  it("maps inventory-token rate limiting without importing a collection error", async () => {
    const deps = dependencies();
    vi.mocked(deps.createInstallationToken).mockRejectedValue(new GitHubInstallationTokenError(
      "rate_limited",
      { retryAfterSeconds: 60, resetAtEpochSeconds: 1_789_388_100 },
    ));

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({
      outcome: "temporary_failure",
      diagnostic: "provider_rate_limited",
      nextAttemptAt: "2026-09-14T12:15:00.000Z",
    });
    expect(deps.finalize).toHaveBeenCalledOnce();
  });

  it("classifies an expired or overlong installation credential as an invalid provider response", async () => {
    for (const expiresAt of ["2026-09-14T12:00:00.000Z", "2026-09-14T13:00:00.001Z", "not-a-date"]) {
      const deps = dependencies();
      vi.mocked(deps.createInstallationToken).mockResolvedValue({
        token: ["unit", "fixture", "short", "authorization"].join(":"),
        expiresAt,
      });

      await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({
        outcome: "temporary_failure",
        diagnostic: "invalid_provider_response",
      });
      expect(deps.readRepositories).not.toHaveBeenCalled();
      expect(deps.finalize).toHaveBeenCalledOnce();
    }
  });

  it("composes metadata, token and repository adapters in provider order", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 77,
        account: { id: 99, login: "Adtecher", type: "Organization" },
        repository_selection: "selected",
        permissions: READ_PERMISSIONS,
        suspended_at: null,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: ["unit", "fixture", "inventory", "authorization"].join(":"),
        expires_at: "2026-09-14T13:00:00.000Z",
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 2,
        repositories: [
          {
            id: 101, owner: { login: "Adtecher" }, name: "repo-101",
            full_name: "Adtecher/repo-101", html_url: "https://github.com/Adtecher/repo-101",
            visibility: "private", archived: false, default_branch: "main",
          },
          {
            id: 102, owner: { login: "Adtecher" }, name: "repo-102",
            full_name: "Adtecher/repo-102", html_url: "https://github.com/Adtecher/repo-102",
            visibility: "private", archived: false, default_branch: "main",
          },
        ],
      }), { status: 200 }));
    const deps = dependencies();
    deps.readMetadata.mockImplementation((input) => readInstallationMetadata({ ...input, fetchImpl }));
    vi.mocked(deps.createInstallationToken).mockImplementation((input) => (
      createInstallationInventoryToken({ ...input, fetchImpl })
    ));
    deps.readRepositories.mockImplementation((input) => readInstallationRepositories({ ...input, fetchImpl }));

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({ outcome: "success" });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/app/installations/77",
      "https://api.github.com/app/installations/77/access_tokens",
      "https://api.github.com/installation/repositories?per_page=100",
    ]);
    expect(deps.finalize).toHaveBeenCalledOnce();
  });

  it("keeps an ambiguous token 422 retryable after exact metadata validation", async () => {
    const providerDetail = crypto.randomUUID();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 77,
        account: { id: 99, login: "Adtecher", type: "Organization" },
        repository_selection: "selected",
        permissions: READ_PERMISSIONS,
        suspended_at: null,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(providerDetail, { status: 422 }));
    const deps = dependencies();
    deps.readMetadata.mockImplementation((input) => readInstallationMetadata({ ...input, fetchImpl }));
    vi.mocked(deps.createInstallationToken).mockImplementation((input) => (
      createInstallationInventoryToken({ ...input, fetchImpl })
    ));
    deps.readRepositories.mockImplementation((input) => readInstallationRepositories({ ...input, fetchImpl }));

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({
      outcome: "temporary_failure",
      diagnostic: "provider_temporary_failure",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(deps.readRepositories).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledOnce();
    expect(JSON.stringify(deps.finalize.mock.calls)).not.toContain(providerDetail);
  });

  it.each([
    [
      {
        id: 77,
        account: { id: 99, login: "Adtecher", type: "Organization" },
        repository_selection: "selected",
        permissions: READ_PERMISSIONS,
        suspended_at: "2026-09-14T11:00:00.000Z",
      },
      "installation_suspended",
    ],
    [
      {
        id: 77,
        account: { id: 99, login: "Adtecher", type: "Organization" },
        repository_selection: "selected",
        permissions: { ...READ_PERMISSIONS, contents: "read" },
        suspended_at: null,
      },
      "permission_mismatch",
    ],
  ] as const)("finalizes provider metadata drift as %s before token exchange", async (body, diagnostic) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const deps = dependencies();
    deps.readMetadata.mockImplementation((input) => readInstallationMetadata({ ...input, fetchImpl }));

    await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({
      outcome: "action_required",
      diagnostic,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(deps.createInstallationToken).not.toHaveBeenCalled();
    expect(deps.readRepositories).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledOnce();
  });

  it("aborts and finalizes a whole reconciliation with a one-minute lease margin", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    try {
      const deps = dependencies();
      deps.now = () => new Date();
      deps.readRepositories.mockImplementation(({ signal }: { signal: AbortSignal }) => (
        new Promise((_resolve, reject) => {
          const fail = () => reject(signal.reason);
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        })
      ));
      let finalizedAt = 0;
      deps.finalize.mockImplementation(async () => {
        finalizedAt = Date.now();
        return "none";
      });

      const pending = reconcileGitHubConnection(deps, claim);
      await vi.advanceTimersByTimeAsync(239_999);
      expect(deps.finalize).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;

      expect(result).toMatchObject({
        outcome: "temporary_failure",
        diagnostic: "provider_temporary_failure",
      });
      expect(finalizedAt).toBe(new Date("2026-09-14T12:04:00.000Z").getTime());
      expect(finalizedAt).toBeLessThan(new Date("2026-09-14T12:05:00.000Z").getTime());
      expect(deps.finalize).toHaveBeenCalledOnce();
      const metadataSignal = deps.readMetadata.mock.calls[0]?.[0].signal as AbortSignal;
      const tokenSignal = vi.mocked(deps.createInstallationToken).mock.calls[0]?.[0].signal as AbortSignal;
      const repositorySignal = deps.readRepositories.mock.calls[0]?.[0].signal as AbortSignal;
      expect(metadataSignal).toBe(tokenSignal);
      expect(tokenSignal).toBe(repositorySignal);
      expect(repositorySignal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses only the time remaining before the claim's absolute four-minute deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:03:00.000Z"));
    try {
      const deps = dependencies();
      deps.now = () => new Date();
      deps.readRepositories.mockImplementation(({ signal }: { signal: AbortSignal }) => (
        new Promise((_resolve, reject) => {
          const fail = () => reject(signal.reason);
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        })
      ));
      let finalizedAt = 0;
      deps.finalize.mockImplementation(async () => {
        finalizedAt = Date.now();
        return "none";
      });

      const pending = reconcileGitHubConnection(deps, claim);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(deps.finalize).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toMatchObject({
        outcome: "temporary_failure",
        diagnostic: "provider_temporary_failure",
      });
      expect(finalizedAt).toBe(new Date("2026-09-14T12:04:00.000Z").getTime());
      expect(deps.finalize).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops in-flight provider work on an external abort without finalizing afterward", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    try {
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, "removeEventListener");
      const deps = dependencies();
      deps.now = () => new Date();
      deps.readRepositories.mockImplementation(({ signal }: { signal: AbortSignal }) => (
        new Promise((_resolve, reject) => {
          const stop = () => reject(signal.reason);
          if (signal.aborted) stop();
          else signal.addEventListener("abort", stop, { once: true });
        })
      ));

      const pending = reconcileGitHubConnection(deps, claim, controller.signal);
      const rejected = expect(pending).rejects.toThrow("GitHub reconciliation interrupted");
      await vi.advanceTimersByTimeAsync(0);
      expect(deps.readRepositories).toHaveBeenCalledOnce();
      controller.abort(new Error(`private-${crypto.randomUUID()}`));
      await vi.advanceTimersByTimeAsync(0);

      await rejected;
      expect(deps.finalize).not.toHaveBeenCalled();
      expect(removeListener).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finalizes an already-expired claim without starting provider work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:04:00.000Z"));
    try {
      const deps = dependencies();
      deps.now = () => new Date();

      await expect(reconcileGitHubConnection(deps, claim)).resolves.toMatchObject({
        outcome: "temporary_failure",
        diagnostic: "provider_temporary_failure",
      });

      expect(deps.createAppJwt).not.toHaveBeenCalled();
      expect(deps.readMetadata).not.toHaveBeenCalled();
      expect(deps.createInstallationToken).not.toHaveBeenCalled();
      expect(deps.readRepositories).not.toHaveBeenCalled();
      expect(deps.finalize).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
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
    expect(imports.some((path) => /(?:collection|observation)/i.test(path))).toBe(false);
    expect(source).not.toMatch(/features\/(?:evidence|findings|tasks)|domain\/(?:observation|rules)/i);
  });
});
