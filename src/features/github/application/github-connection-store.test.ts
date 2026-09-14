// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { READ_PERMISSIONS } from "./github-app-auth";
import { buildGitHubConnectionStore } from "./github-connection-store";

const runId = "11111111-1111-4111-8111-111111111111";
const workerId = "22222222-2222-4222-8222-222222222222";
const organisationId = "33333333-3333-4333-8333-333333333333";
const installationId = "44444444-4444-4444-8444-444444444444";

const runRow = {
  id: runId,
  organisation_id: organisationId,
  installation_id: installationId,
  reconciliation_version: 1,
  trigger: "scheduled",
  request_key: "opaque-request-key",
  status: "running",
  diagnostic_code: null,
  incident_transition: null,
  started_at: "2026-09-14T12:00:00.000Z",
  last_attempted_at: "2026-09-14T12:00:00.000Z",
  completed_at: null,
  attempt_count: 1,
  repository_count: 0,
  available_repository_count: 0,
  unavailable_repository_count: 0,
};

const installationRow = {
  id: installationId,
  organisation_id: organisationId,
  provider_installation_id: 77,
  account_id: 99,
  account_login: "Adtecher",
  account_type: "Organization",
  repository_selection: "selected",
  status: "active",
  permissions: { ...READ_PERMISSIONS },
  permissions_ok: true,
  health: "healthy",
  consecutive_reconciliation_failures: 0,
  reconciliation_version: 1,
};

const repositoryRows = [101, 102].map((providerId) => ({
  id: `${String(providerId).padStart(8, "0")}-0000-4000-8000-000000000000`,
  organisation_id: organisationId,
  installation_id: installationId,
  provider_repository_id: providerId,
  owner_login: "Adtecher",
  name: `repo-${providerId}`,
  full_name: `Adtecher/repo-${providerId}`,
  selected: true,
})).concat([{
  id: "00000103-0000-4000-8000-000000000000",
  organisation_id: organisationId,
  installation_id: installationId,
  provider_repository_id: 103,
  owner_login: "Adtecher",
  name: "not-selected",
  full_name: "Adtecher/not-selected",
  selected: false,
}]);

type Row = Record<string, unknown>;

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private readonly filters: Array<[string, unknown]> = [];
  private maximum: number | null = null;

  constructor(private readonly rows: Row[], private readonly ignoreFilters = false) {}
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order() { return this; }
  limit(value: number) { this.maximum = value; return this; }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let rows = this.ignoreFilters
      ? this.rows
      : this.rows.filter((row) => this.filters.every(([key, value]) => row[key] === value));
    if (this.maximum !== null) rows = rows.slice(0, this.maximum);
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }
}

function service(overrides: {
  installation?: Row[];
  repositories?: Row[];
  claim?: unknown;
  finalize?: unknown;
  ignoreFilters?: boolean;
} = {}) {
  const rows = {
    github_installations: overrides.installation ?? [installationRow],
    github_repositories: overrides.repositories ?? repositoryRows,
  } as Record<string, Row[]>;
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_due_github_connection_reconciliations_server") {
      return { data: overrides.claim ?? [runRow], error: null };
    }
    const data = Object.prototype.hasOwnProperty.call(overrides, "finalize")
      ? overrides.finalize
      : "none";
    return { data, error: null };
  });
  return {
    rpc,
    from: vi.fn((table: string) => ({
      select: () => new Query(rows[table] ?? [], overrides.ignoreFilters === true),
    })),
  };
}

describe("buildGitHubConnectionStore", () => {
  it("claims and validates a fully tenant-bound stored installation with Owner-selected scope", async () => {
    const database = service();
    const store = buildGitHubConnectionStore(database);

    const claimed = await store.claimDue({
      workerId,
      limit: 1,
      now: "2026-09-14T12:00:00.000Z",
    });

    expect(database.rpc).toHaveBeenCalledWith("claim_due_github_connection_reconciliations_server", {
      target_worker_id: workerId,
      target_limit: 1,
      target_now: "2026-09-14T12:00:00.000Z",
    });
    expect(claimed).toEqual([{
      runId,
      workerId,
      organisationId,
      installationId,
      providerInstallationId: 77,
      account: { id: 99, login: "Adtecher", type: "Organization" },
      repositorySelection: "selected",
      permissions: READ_PERMISSIONS,
      selectedRepositoryIds: [101, 102],
      previousHealth: "healthy",
      consecutiveFailures: 0,
      attemptedAt: "2026-09-14T12:00:00.000Z",
    }]);
  });

  it.each([
    ["needs_attention", "owner_action_required"],
    ["revoked", "disconnected"],
  ])("accepts one version-bearing %s follow-up claim without restoring scope", async (status, health) => {
    const database = service({
      claim: [{ ...runRow, reconciliation_version: 2 }],
      installation: [{
        ...installationRow,
        status,
        health,
        permissions_ok: false,
        reconciliation_version: 2,
      }],
    });
    const store = buildGitHubConnectionStore(database);

    await expect(store.claimDue({
      workerId,
      limit: 1,
      now: "2026-09-14T12:00:00.000Z",
    })).resolves.toEqual([expect.objectContaining({
      runId,
      installationId,
      previousHealth: health,
    })]);

    expect(database.from).toHaveBeenCalledWith("github_installations");
  });

  it.each([
    ["run ancestry", { claim: [{ ...runRow, organisation_id: "55555555-5555-4555-8555-555555555555" }], ignoreFilters: true }],
    ["installation ancestry", { installation: [{ ...installationRow, organisation_id: "55555555-5555-4555-8555-555555555555" }], ignoreFilters: true }],
    ["repository ancestry", { repositories: [{ ...repositoryRows[0]!, organisation_id: "55555555-5555-4555-8555-555555555555" }], ignoreFilters: true }],
    ["stored permissions", { installation: [{ ...installationRow, permissions: { ...READ_PERMISSIONS, contents: "read" } }] }],
    ["duplicate repository identity", { repositories: [repositoryRows[0]!, { ...repositoryRows[0]!, id: "99999999-9999-4999-8999-999999999999" }] }],
    ["run occurrence version", { claim: [{ ...runRow, reconciliation_version: 2 }] }],
    ["stale fail-closed occurrence", { claim: [{ ...runRow, reconciliation_version: 1 }], installation: [{ ...installationRow, status: "revoked", health: "disconnected", permissions_ok: false, reconciliation_version: 2 }] }],
  ])("rejects malformed or cross-tenant %s rows", async (_label, overrides) => {
    const store = buildGitHubConnectionStore(service(overrides));
    await expect(store.claimDue({ workerId, limit: 1, now: "2026-09-14T12:00:00.000Z" }))
      .rejects.toThrow("GitHub connection persistence failed");
  });

  it("finalizes through the compare-and-set RPC with safe fields and full claim ownership", async () => {
    const database = service({ finalize: "opened" });
    const store = buildGitHubConnectionStore(database);
    const [claimed] = await store.claimDue({ workerId, limit: 1, now: "2026-09-14T12:00:00.000Z" });

    await expect(store.finalize(claimed!, {
      outcome: "partial",
      diagnostic: "repository_unavailable",
      nextAttemptAt: "2026-09-15T12:00:00.000Z",
      repositorySnapshot: [{
        id: 101,
        owner: "Adtecher",
        name: "renamed",
        fullName: "Adtecher/renamed",
        htmlUrl: "https://github.com/Adtecher/renamed",
        visibility: "private",
        archived: false,
        defaultBranch: "main",
      }],
    })).resolves.toBe("opened");

    expect(database.rpc).toHaveBeenLastCalledWith("finalize_github_connection_reconciliation_server", {
      target_run_id: runId,
      target_worker_id: workerId,
      target_outcome: "partial",
      target_diagnostic_code: "repository_unavailable",
      target_next_attempt_at: "2026-09-15T12:00:00.000Z",
      target_repository_snapshot: [expect.objectContaining({ id: 101, fullName: "Adtecher/renamed" })],
    });
    expect(JSON.stringify(database.rpc.mock.calls)).not.toMatch(/credential|token|provider body/i);
  });

  it.each([
    null,
    "not_finalized",
    "unexpected",
    ["none", "opened"],
  ])("rejects an invalid finalization result (%s)", async (finalize) => {
    const store = buildGitHubConnectionStore(service({ finalize }));
    const [claimed] = await store.claimDue({ workerId, limit: 1, now: "2026-09-14T12:00:00.000Z" });
    await expect(store.finalize(claimed!, {
      outcome: "success",
      diagnostic: null,
      nextAttemptAt: "2026-09-15T12:00:00.000Z",
      repositorySnapshot: [],
    })).rejects.toThrow("GitHub connection persistence failed");
  });
});
