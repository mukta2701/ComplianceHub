import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  createAppJwt: vi.fn().mockResolvedValue("app-jwt"),
  createInstallationToken: vi.fn().mockResolvedValue({
    token: ["installation", "credential"].join("-"),
    expiresAt: "2026-08-17T06:00:00Z",
  }),
  collectRepositoryFacts: vi.fn().mockResolvedValue({}),
}));

vi.mock("./github-app-auth", () => ({
  createAppJwt: hoisted.createAppJwt,
  createInstallationToken: hoisted.createInstallationToken,
}));
vi.mock("./collect-repository-facts", () => ({ collectRepositoryFacts: hoisted.collectRepositoryFacts }));

import { buildCollectionDependencies } from "./collection-deps";
import { runGitHubCollection } from "./run-collection";

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function repository(index: number, installationIndex = 1): Row {
  const installationId = uuid(10_000 + installationIndex);
  const organisationId = uuid(20_000 + installationIndex);
  return {
    id: uuid(30_000 + index),
    organisation_id: organisationId,
    installation_id: installationId,
    provider_repository_id: 40_000 + index,
    owner_login: `org-${installationIndex}`,
    name: `repo-${index}`,
    selected: true,
    available: true,
    github_installations: {
      id: installationId,
      organisation_id: organisationId,
      provider_installation_id: 50_000 + installationIndex,
      status: "active",
      permissions_ok: true,
    },
  };
}

function valueAt(row: Row, column: string): unknown {
  if (column.startsWith("github_installations.")) {
    return (row.github_installations as Row)[column.slice("github_installations.".length)];
  }
  return row[column];
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private maximum: number | null = null;
  private window: [number, number] | null = null;

  constructor(private readonly rows: Row[], private readonly calls: Array<{ kind: string; values: number[] }>) {}

  eq(column: string, value: unknown) { this.filters.push({ column, value }); return this; }
  order() { return this; }
  limit(count: number) { this.maximum = count; this.calls.push({ kind: "limit", values: [count] }); return this; }
  range(from: number, to: number) { this.window = [from, to]; this.calls.push({ kind: "range", values: [from, to] }); return this; }

  private result() {
    let rows = this.rows.filter((row) => this.filters.every((filter) => valueAt(row, filter.column) === filter.value));
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    if (this.maximum !== null) rows = rows.slice(0, this.maximum);
    return { data: rows, error: null };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

function client(rows: Row[], rpc = vi.fn().mockResolvedValue({ data: true, error: null })) {
  const calls: Array<{ kind: string; values: number[] }> = [];
  return {
    calls,
    rpc,
    from: vi.fn(() => ({ select: () => new Query(rows, calls) })),
  };
}

const configuration = { appId: "1", privateKey: "key", approvedSecurityWorkflowIds: [1] };

beforeEach(() => {
  hoisted.createAppJwt.mockClear();
  hoisted.createInstallationToken.mockClear();
  hoisted.collectRepositoryFacts.mockClear();
});

describe("buildCollectionDependencies", () => {
  it("loads a verified selected target and scopes one cached token to its installation repositories", async () => {
    const first = repository(1);
    const second = repository(2);
    const service = client([first, second]);
    const deps = buildCollectionDependencies(service, configuration);
    const targets = await deps.listTargets({ trigger: "scheduled", requestKey: "scheduled:2026-08-17" });

    expect(targets).toHaveLength(2);
    await deps.collectFacts(targets[0]!);
    await deps.collectFacts(targets[1]!);
    expect(hoisted.createInstallationToken).toHaveBeenCalledTimes(1);
    expect(hoisted.createInstallationToken).toHaveBeenCalledWith(expect.objectContaining({
      installationId: 50_001,
      repositoryIds: [40_001, 40_002],
      appJwt: "app-jwt",
    }));
  });

  it("reuses one preloaded in-memory token for the exact scoped installation and repository", async () => {
    const row = repository(1);
    const service = client([row]);
    const inMemoryCredential = "synthetic-in-memory-credential";
    const deps = buildCollectionDependencies(service, {
      ...configuration,
      preloadedInstallationToken: {
        installationId: String(row.installation_id),
        providerInstallationId: 50_001,
        repositoryIds: [40_001],
        token: inMemoryCredential,
      },
    });
    const [target] = await deps.listTargets({
      trigger: "manual",
      requestKey: "manual:preloaded-token",
      installationId: String(row.installation_id),
      repositoryId: String(row.id),
    });

    await deps.collectFacts(target!);

    expect(hoisted.createInstallationToken).not.toHaveBeenCalled();
    expect(hoisted.collectRepositoryFacts).toHaveBeenCalledWith(expect.objectContaining({
      installationToken: inMemoryCredential,
    }));
  });

  it("paginates all scheduled targets and permits more than 100 across installations", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => repository(index + 1, Math.floor(index / 100) + 1));
    const service = client(rows);
    const deps = buildCollectionDependencies(service, configuration);
    const targets = await deps.listTargets({ trigger: "scheduled", requestKey: "scheduled:2026-08-17" });

    expect(targets).toHaveLength(1_001);
    expect(service.calls.filter((call) => call.kind === "range")).toEqual([
      { kind: "range", values: [0, 999] },
      { kind: "range", values: [1_000, 1_999] },
    ]);
  });

  it("rejects 101 repositories in one installation while the query limit remains effective", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => repository(index + 1));
    const service = client(rows);
    const deps = buildCollectionDependencies(service, configuration);
    await expect(deps.listTargets({ trigger: "manual", requestKey: "manual:too-many", installationId: uuid(10_001) })).rejects.toThrow("GitHub collection target loading failed");
    expect(service.calls).toContainEqual({ kind: "limit", values: [101] });
  });

  it.each([
    {
      label: "tenant ancestry",
      mutate: (row: Row) => { (row.github_installations as Row).organisation_id = uuid(99_001); },
    },
    {
      label: "local-to-provider installation mapping",
      mutate: (row: Row) => { (row.github_installations as Row).provider_installation_id = 99_001; },
    },
  ])("rejects malformed $label before provider work", async ({ mutate, label }) => {
    const first = repository(1);
    const second = repository(2);
    mutate(label === "tenant ancestry" ? first : second);
    const deps = buildCollectionDependencies(client([first, second]), configuration);
    await expect(deps.listTargets({ trigger: "scheduled", requestKey: "scheduled:2026-08-17" })).rejects.toThrow("GitHub collection target loading failed");
    expect(hoisted.createInstallationToken).not.toHaveBeenCalled();
  });

  it("passes full ancestry and the current lease to refresh and finalization RPCs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const deps = buildCollectionDependencies(client([], rpc), configuration);
    const target = { organisationId: uuid(1), installationId: uuid(2), repositoryId: uuid(3), providerInstallationId: 77, providerRepositoryId: 101, owner: "adtecher", name: "portal" };
    const lease = { runId: uuid(4), leaseToken: uuid(5), leaseExpiresAt: "2026-08-17T05:31:00.000Z", attempt: 2, runMode: "official" as const, acquisitionState: "reclaimed" as const, status: "running" as const, organisationId: uuid(1), installationId: uuid(2), repositoryId: uuid(3), providerRepositoryId: 101 };
    const facts = { repository: { id: 101, owner: "adtecher", name: "renamed", visibility: "private" as const, archived: false, defaultBranch: "trunk", url: "https://github.com/adtecher/renamed" } };

    await deps.refreshRepository(lease, target, facts as never);
    await deps.finaliseRun(lease, target, { status: "failed", diagnosticCode: "invalid_response", observationCount: 0, passedCount: 0, failedCount: 0, unknownCount: 0, notApplicableCount: 0 });

    expect(rpc).toHaveBeenCalledWith("refresh_github_repository_server", expect.objectContaining({ target_run_id: uuid(4), target_organisation_id: uuid(1), target_installation_id: uuid(2), target_repository_id: uuid(3), target_provider_repository_id: 101, target_lease_token: uuid(5), target_attempt: 2 }));
    expect(rpc).toHaveBeenCalledWith("finalise_github_collection_run_server", expect.objectContaining({ target_run_id: uuid(4), target_lease_token: uuid(5), target_attempt: 2 }));
  });

  it.each([
    { requestedMode: "official" as const, rpcName: "reserve_github_collection_run_server" },
    { requestedMode: "shadow" as const, rpcName: "reserve_github_shadow_collection_run_server" },
  ])("uses the $requestedMode service reservation boundary and returns that trusted mode", async ({ requestedMode, rpcName }) => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        run_id: uuid(4),
        lease_token: uuid(5),
        lease_expires_at: "2026-08-17T05:31:00.000Z",
        attempt: 1,
        acquisition_state: "acquired",
        status: "running",
        organisation_id: uuid(1),
        installation_id: uuid(2),
        repository_id: uuid(3),
        provider_repository_id: 101,
        run_mode: requestedMode,
      },
      error: null,
    });
    const deps = buildCollectionDependencies(client([], rpc), configuration);
    const item = { organisationId: uuid(1), installationId: uuid(2), repositoryId: uuid(3), providerInstallationId: 77, providerRepositoryId: 101, owner: "adtecher", name: "portal" };

    const lease = await deps.reserveRun(item, {
      trigger: "manual",
      requestKey: `manual:${requestedMode}`,
      runMode: requestedMode,
    });

    expect(rpc).toHaveBeenCalledWith(rpcName, expect.objectContaining({
      target_request_key: `manual:${requestedMode}`,
    }));
    expect(lease.runMode).toBe(requestedMode);
  });

  it("rejects a shadow reservation when the database returns authoritative official mode", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        run_id: uuid(4),
        lease_token: uuid(5),
        lease_expires_at: "2026-08-17T05:31:00.000Z",
        attempt: 1,
        acquisition_state: "acquired",
        status: "running",
        organisation_id: uuid(1),
        installation_id: uuid(2),
        repository_id: uuid(3),
        provider_repository_id: 101,
        run_mode: "official",
      },
      error: null,
    });
    const deps = buildCollectionDependencies(client([], rpc), configuration);
    const item = { organisationId: uuid(1), installationId: uuid(2), repositoryId: uuid(3), providerInstallationId: 77, providerRepositoryId: 101, owner: "adtecher", name: "portal" };

    await expect(deps.reserveRun(item, {
      trigger: "manual",
      requestKey: "manual:shadow-mismatch",
      runMode: "shadow",
    })).rejects.toThrow("GitHub collection persistence failed");

    expect(rpc).toHaveBeenCalledWith("reserve_github_shadow_collection_run_server", expect.anything());
  });

  it("stops the real adapter path before collection or persistence when the database mode disagrees", async () => {
    const row = repository(1);
    const rpc = vi.fn().mockResolvedValue({
      data: {
        run_id: uuid(4),
        lease_token: uuid(5),
        lease_expires_at: "2026-08-17T05:31:00.000Z",
        attempt: 1,
        acquisition_state: "acquired",
        status: "running",
        organisation_id: row.organisation_id,
        installation_id: row.installation_id,
        repository_id: row.id,
        provider_repository_id: row.provider_repository_id,
        run_mode: "official",
      },
      error: null,
    });
    const deps = buildCollectionDependencies(client([row], rpc), configuration);

    const summary = await runGitHubCollection(deps, {
      trigger: "manual",
      requestKey: "manual:shadow-adapter-mismatch",
      runMode: "shadow",
      installationId: String(row.installation_id),
    });

    expect(summary.repositoriesFailed).toBe(1);
    expect(summary.repositoriesChecked).toBe(0);
    expect(hoisted.collectRepositoryFacts).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("save_github_observations_server", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("finalise_github_collection_run_server", expect.anything());
  });

  it("fails closed when a scoped local target does not resolve", async () => {
    const deps = buildCollectionDependencies(client([]), configuration);
    await expect(deps.listTargets({ trigger: "manual", requestKey: "manual:missing", repositoryId: uuid(30_001) })).rejects.toThrow("GitHub collection target loading failed");
  });

  it("never exposes phase-two evidence, finding, or Slack dependencies", () => {
    const deps = buildCollectionDependencies(client([]), configuration);
    expect(deps).not.toHaveProperty("createEvidence");
    expect(deps).not.toHaveProperty("saveFinding");
    expect(deps).not.toHaveProperty("deliverSlack");
    expect(deps).not.toHaveProperty("materialise");
  });
});
