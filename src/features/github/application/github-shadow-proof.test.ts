// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import completeFixture from "./fixtures/repository-complete.json";
import { EXPECTED_GITHUB_CHECK_IDS } from "../domain/rules";
import {
  createGitHubShadowFetchLedger,
  runGitHubShadowProof,
  writeGitHubShadowProofFile,
} from "./github-shadow-proof";

const scope = {
  providerInstallationId: 154_509_880,
  providerRepositoryId: 101,
  owner: "mukta2701",
  name: "ComplianceHub",
};

const exactReadPermissions = {
  actions: "read",
  administration: "read",
  metadata: "read",
  secret_scanning_alerts: "read",
  security_events: "read",
  vulnerability_alerts: "read",
};

const organisationId = "00000000-0000-4000-8000-000000000001";
const installationId = "00000000-0000-4000-8000-000000000002";
const repositoryId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const leaseIdentifier = "00000000-0000-4000-8000-000000000005";
const repeatRunId = "00000000-0000-4000-8000-000000000006";
const repeatLeaseIdentifier = "00000000-0000-4000-8000-000000000007";
const fixtureInstallationCredential = "synthetic-installation-credential";
const privateCredentialFixture = "synthetic-private-credential";
const githubEndpoint = `https://api.github.com/app/installations/154509880/${["access", "tokens"].join("_")}`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const appPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const selectedScope = {
  organisationId,
  installationId,
  repositoryId,
  providerInstallationId: scope.providerInstallationId,
  providerRepositoryId: 101,
  accountId: 61_040_544,
  accountLogin: "mukta2701",
  accountType: "User",
  installationStatus: "active",
  permissionsOk: true,
  owner: "mukta2701",
  name: "ComplianceHub",
  selected: true,
  available: true,
};

const protectedState = (suffix = "0") => ({
  materialisationJobs: { count: 0, sha256: suffix.repeat(64) },
  officialResults: { count: 0, sha256: suffix.repeat(64) },
  githubEvidenceProvenance: { count: 0, sha256: suffix.repeat(64) },
  githubFindingProvenance: { count: 0, sha256: suffix.repeat(64) },
  evidenceAndFindings: { count: 0, sha256: suffix.repeat(64) },
  readinessSoaAssessmentRisk: { count: 0, sha256: suffix.repeat(64) },
  githubMappingApprovalLineage: { count: 0, sha256: suffix.repeat(64) },
  mcpDigest: { count: 1, sha256: suffix.repeat(64) },
  slackDeliveries: { count: 0, sha256: suffix.repeat(64) },
});

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

function valueAt(row: Row, column: string): unknown {
  if (column.startsWith("github_installations.")) {
    return (row.github_installations as Row)[column.slice("github_installations.".length)];
  }
  return row[column];
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private readonly filters: Filter[] = [];
  private maximum: number | null = null;

  constructor(private readonly rows: () => Row[]) {}
  eq(column: string, value: unknown) { this.filters.push({ column, value }); return this; }
  order() { return this; }
  limit(count: number) { this.maximum = count; return this; }
  range(from: number, to: number) {
    const values = this.result().data as Row[];
    return Promise.resolve({ data: values.slice(from, to + 1), error: null });
  }
  private result() {
    let values = this.rows().filter((row) => this.filters.every((filter) => valueAt(row, filter.column) === filter.value));
    if (this.maximum !== null) values = values.slice(0, this.maximum);
    return { data: values, error: null };
  }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

function collectionService() {
  const observations: Row[] = [];
  const statuses = new Map<string, string>();
  const reservations = [
    { runId, leaseToken: leaseIdentifier },
    { runId: repeatRunId, leaseToken: repeatLeaseIdentifier },
  ];
  let activeRunId = runId;
  const repositoryRow = {
    id: repositoryId,
    organisation_id: organisationId,
    installation_id: installationId,
    provider_repository_id: 101,
    owner_login: "mukta2701",
    name: "ComplianceHub",
    selected: true,
    available: true,
    github_installations: {
      id: installationId,
      organisation_id: organisationId,
      provider_installation_id: scope.providerInstallationId,
      status: "active",
      permissions_ok: true,
    },
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "reserve_github_shadow_collection_run_server") {
      const reservation = reservations.shift();
      if (!reservation) throw new Error("unexpected third reservation");
      activeRunId = reservation.runId;
      statuses.set(activeRunId, "running");
      return { data: {
        run_id: reservation.runId,
        lease_token: reservation.leaseToken,
        lease_expires_at: "2026-09-01T15:00:00.000Z",
        attempt: 1,
        acquisition_state: "acquired",
        status: "running",
        organisation_id: organisationId,
        installation_id: installationId,
        repository_id: repositoryId,
        provider_repository_id: 101,
        run_mode: "shadow",
      }, error: null };
    }
    if (name === "refresh_github_repository_server") return { data: true, error: null };
    if (name === "save_github_observations_server") {
      const rows = args.target_observations as Row[];
      observations.push(...rows.map((row) => ({
        ...row,
        organisation_id: organisationId,
        installation_id: installationId,
        repository_id: repositoryId,
        provider_repository_id: 101,
        collection_run_id: activeRunId,
      })));
      return { data: rows.length, error: null };
    }
    if (name === "finalise_github_collection_run_server") {
      statuses.set(activeRunId, String(args.target_status));
      return { data: true, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  const service = {
    rpc,
    from: vi.fn((table: string) => ({
      select: () => new Query(() => table === "github_repositories" ? [repositoryRow] : observations),
    })),
  };
  return { service, rpc, observations, getStatus: (targetRunId: string) => statuses.get(targetRunId) ?? "running" };
}

function persistedOutcome(collection: ReturnType<typeof collectionService>, targetRunId = runId) {
  const runObservations = collection.observations.filter((row) => row.collection_run_id === targetRunId);
  return {
    runMode: "shadow",
    status: collection.getStatus(targetRunId),
    organisationId,
    installationId,
    repositoryId,
    providerRepositoryId: 101,
    observationCount: runObservations.length,
    materialisationJobCount: 0,
    observations: runObservations.map((row) => ({
      organisationId: row.organisation_id,
      installationId: row.installation_id,
      repositoryId: row.repository_id,
      providerRepositoryId: row.provider_repository_id,
      collectionRunId: row.collection_run_id,
      checkId: row.check_id,
      ruleVersion: row.rule_version,
      result: row.result,
      diagnosticCode: row.diagnostic_code,
      observedAt: row.observed_at,
      freshUntil: row.fresh_until,
      fingerprint: row.fingerprint,
    })),
  };
}

function providerFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === `/app/installations/${scope.providerInstallationId}/access_tokens`) {
      return Response.json({ token: fixtureInstallationCredential, expires_at: "2026-09-01T15:00:00Z" });
    }
    const metadata = {
      ...completeFixture.metadata,
      owner: { login: "mukta2701" },
      name: "ComplianceHub",
      full_name: "mukta2701/ComplianceHub",
      id: 101,
    };
    if (url.pathname === "/repos/mukta2701/ComplianceHub") return Response.json(metadata);
    if (url.pathname.endsWith("/rules/branches/main")) return Response.json(completeFixture.rules);
    if (url.pathname.endsWith("/branches/main/protection")) return Response.json(completeFixture.protection);
    if (url.pathname.endsWith("/dependabot/alerts")) return Response.json(completeFixture.dependabot);
    if (url.pathname.endsWith("/code-scanning/alerts")) return Response.json(url.searchParams.get("severity") === "critical" ? completeFixture.codeScanningCritical : completeFixture.codeScanningHigh);
    if (url.pathname.endsWith("/secret-scanning/alerts")) return Response.json(completeFixture.secretAlerts);
    if (url.pathname.endsWith("/actions/workflows")) return Response.json(completeFixture.workflows);
    if (url.pathname.endsWith("/actions/workflows/31/runs")) return Response.json(completeFixture.workflowRuns);
    if (url.pathname.endsWith("/collaborators")) return Response.json(completeFixture.collaborators);
    if (url.pathname.endsWith("/git/ref/heads/main")) return Response.json({
      ref: "refs/heads/main",
      object: { type: "commit", sha: "a".repeat(40) },
    });
    throw new Error(`unexpected provider path ${url.pathname}`);
  });
}

describe("createGitHubShadowFetchLedger", () => {
  it("records only a bounded template and status class for the permitted token POST and repository GET", async () => {
    const provider = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      return url.pathname.endsWith("/access_tokens")
        ? Response.json({ token: privateCredentialFixture, expires_at: "2026-09-01T15:00:00Z" })
        : Response.json({ id: 101 });
    });
    const ledger = createGitHubShadowFetchLedger(scope, provider as typeof fetch);

    await ledger.fetch(githubEndpoint, {
      method: "POST",
      headers: { authorization: "Bearer private-app-jwt" },
      body: JSON.stringify({ repository_ids: [101], permissions: exactReadPermissions }),
      redirect: "error",
    });
    await ledger.fetch("https://api.github.com/repos/mukta2701/ComplianceHub", {
      method: "GET",
      headers: { authorization: `Bearer ${privateCredentialFixture}` },
      redirect: "error",
    });

    expect(ledger.summary()).toEqual({
      requestCount: 2,
      entries: [
        { method: "POST", origin: "https://api.github.com", pathTemplate: "/app/installations/{installation_id}/access_tokens", statusClass: "2xx", count: 1 },
        { method: "GET", origin: "https://api.github.com", pathTemplate: "/repos/{owner}/{repository}", statusClass: "2xx", count: 1 },
      ],
    });
    expect(JSON.stringify(ledger.summary())).not.toMatch(/private|154509880|mukta2701|ComplianceHub|authorization/i);
  });

  it.each([
    ["mutation", "https://api.github.com/repos/mukta2701/ComplianceHub", { method: "PATCH" }],
    ["unexpected origin", "https://api.github.test/repos/mukta2701/ComplianceHub", { method: "GET" }],
    ["unknown path", "https://api.github.com/repos/mukta2701/ComplianceHub/contents", { method: "GET" }],
  ])("rejects %s before provider I/O", async (_label, url, init) => {
    const provider = vi.fn();
    const ledger = createGitHubShadowFetchLedger(scope, provider as typeof fetch);

    await expect(ledger.fetch(url, init)).rejects.toThrow("GitHub shadow proof request denied");
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects provider redirects and does not retain the redirect location", async () => {
    const provider = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.test/private" },
    }));
    const ledger = createGitHubShadowFetchLedger(scope, provider as typeof fetch);

    await expect(ledger.fetch("https://api.github.com/repos/mukta2701/ComplianceHub", {
      method: "GET",
      redirect: "error",
    })).rejects.toThrow("GitHub shadow proof request denied");
    expect(JSON.stringify(ledger.summary())).not.toContain("attacker");
  });

  it("rejects a second installation-token mint before provider I/O", async () => {
    const provider = vi.fn(async () => Response.json({
      token: fixtureInstallationCredential,
      expires_at: "2026-09-01T15:00:00Z",
    }));
    const ledger = createGitHubShadowFetchLedger(scope, provider as typeof fetch);
    const request = {
      method: "POST",
      body: JSON.stringify({ repository_ids: [101], permissions: exactReadPermissions }),
      redirect: "error" as const,
    };

    await ledger.fetch(githubEndpoint, request);
    await expect(ledger.fetch(
      githubEndpoint,
      request,
    )).rejects.toThrow("GitHub shadow proof request denied");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("never retries a token mint after provider I/O has started", async () => {
    const provider = vi.fn(async () => { throw new Error("provider transport failure"); });
    const ledger = createGitHubShadowFetchLedger(scope, provider as typeof fetch);
    const request = {
      method: "POST",
      body: JSON.stringify({ repository_ids: [101], permissions: exactReadPermissions }),
      redirect: "error" as const,
    };

    await expect(ledger.fetch(
      githubEndpoint,
      request,
    )).rejects.toThrow("provider transport failure");
    await expect(ledger.fetch(
      githubEndpoint,
      request,
    )).rejects.toThrow("GitHub shadow proof request denied");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong repository", { repository_ids: [102], permissions: exactReadPermissions }],
    ["multiple repositories", { repository_ids: [101, 102], permissions: exactReadPermissions }],
    ["permission widening", { repository_ids: [101], permissions: { ...exactReadPermissions, contents: "write" } }],
    ["extra key", { repository_ids: [101], permissions: exactReadPermissions, note: "private" }],
  ])("rejects a token mint with %s before provider I/O", async (_label, body) => {
    const provider = vi.fn();
    const ledger = createGitHubShadowFetchLedger(scope, provider as typeof fetch);

    await expect(ledger.fetch(githubEndpoint, {
      method: "POST",
      body: JSON.stringify(body),
      redirect: "error",
    })).rejects.toThrow("GitHub shadow proof request denied");
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("runGitHubShadowProof", () => {
  it("runs two distinct shadow collections and proves their stable semantics without protected-state changes", async () => {
    const collection = collectionService();
    const proofTempRoot = await mkdtemp(join(tmpdir(), "github-shadow-proof-test-"));
    const fetchImpl = providerFetch();
    let protectedStateCaptures = 0;
    const result = await runGitHubShadowProof({
      service: collection.service,
      allowedAccountId: 61_040_544,
      appId: "1",
      privateKey: appPrivateKey,
      approvedSecurityWorkflowIds: [31],
      fetchImpl: fetchImpl as typeof fetch,
      requestKey: "manual:shadow-proof-safe",
      proofTempRoot,
      inspectLocalTarget: async () => "supabase_db_compliancehub",
      loadScope: async () => [selectedScope],
      captureProtectedState: async () => {
        protectedStateCaptures += 1;
        return protectedState();
      },
      inspectShadowOutcome: async (targetRunId) => persistedOutcome(collection, targetRunId),
    });

    expect(collection.observations).toHaveLength(30);
    const reservations = collection.rpc.mock.calls.filter(([name]) => name === "reserve_github_shadow_collection_run_server");
    expect(reservations).toHaveLength(2);
    expect(reservations.map(([, args]) => args.target_request_key)).toEqual([
      "manual:shadow-proof-safe:first",
      "manual:shadow-proof-safe:repeat",
    ]);
    expect(collection.rpc).not.toHaveBeenCalledWith("reserve_github_collection_run_server", expect.anything());
    expect(protectedStateCaptures).toBe(3);
    expect(result.summary).toMatchObject({
      runMode: "shadow",
      repeatabilityMatched: true,
      runs: [
        { observationCount: 15, materialisationJobCount: 0 },
        { observationCount: 15, materialisationJobCount: 0 },
      ],
    });
    expect((await stat(result.proofPath)).mode & 0o777).toBe(0o600);
    const proofText = await readFile(result.proofPath, "utf8");
    expect(proofText).not.toContain(fixtureInstallationCredential);
    expect(proofText).not.toMatch(/PRIVATE KEY|authorization/i);
    expect(proofText).not.toContain('"mukta2701"');
    expect(proofText).not.toContain('"ComplianceHub"');
    const proof = JSON.parse(proofText);
    expect(proof).toMatchObject({
      schemaVersion: 1,
      runMode: "shadow",
      runReferencesSha256: [
        expect.stringMatching(/^[a-f0-9]{64}$/),
        expect.stringMatching(/^[a-f0-9]{64}$/),
      ],
      repositoryFingerprint: {
        before: {
          identityConfigurationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          defaultBranchHeadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          safeFactsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        between: {
          identityConfigurationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          defaultBranchHeadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          safeFactsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        after: {
          identityConfigurationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          defaultBranchHeadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          safeFactsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        matched: true,
      },
      protectedState: {
        before: protectedState(),
        between: protectedState(),
        after: protectedState(),
        matched: true,
      },
      outcomes: [
        { observationCount: 15, materialisationJobCount: 0 },
        { observationCount: 15, materialisationJobCount: 0 },
      ],
      repeatability: {
        matched: true,
        stableSemanticsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(new Set(proof.runReferencesSha256).size).toBe(2);
    expect(fetchImpl.mock.calls.filter(([request]) => new URL(String(request)).pathname.endsWith("/access_tokens"))).toHaveLength(1);
    expect(proof.ledger.entries).toContainEqual({
      method: "POST",
      origin: "https://api.github.com",
      pathTemplate: "/app/installations/{installation_id}/access_tokens",
      statusClass: "2xx",
      count: 1,
    });
    expect(proof.ledger.entries).toContainEqual({
      method: "GET",
      origin: "https://api.github.com",
      pathTemplate: "/repos/{owner}/{repository}/git/ref/heads/{branch}",
      statusClass: "2xx",
      count: 3,
    });
  });

  it.each([
    ["wrong target", { inspectLocalTarget: async () => "supabase_db_other" }],
    ["wrong installation account", { loadScope: async () => [{ ...selectedScope, accountLogin: "attacker" }] }],
    ["wrong immutable account id", { loadScope: async () => [{ ...selectedScope, accountId: 999 }] }],
    ["multiple repositories", { loadScope: async () => [selectedScope, { ...selectedScope, repositoryId: "00000000-0000-4000-8000-000000000099", providerRepositoryId: 102 }] }],
  ])("fails closed for %s before provider I/O", async (_label, overrides) => {
    const collection = collectionService();
    const fetchImpl = providerFetch();
    await expect(runGitHubShadowProof({
      service: collection.service,
      allowedAccountId: 61_040_544,
      appId: "1",
      privateKey: appPrivateKey,
      approvedSecurityWorkflowIds: [31],
      fetchImpl: fetchImpl as typeof fetch,
      requestKey: "manual:shadow-proof-negative",
      inspectLocalTarget: async () => "supabase_db_compliancehub",
      loadScope: async () => [selectedScope],
      captureProtectedState: async () => protectedState(),
      inspectShadowOutcome: async () => ({ runMode: "shadow", status: "succeeded", observationCount: 15, materialisationJobCount: 0 }),
      ...overrides,
    })).rejects.toThrow("GitHub shadow proof precondition failed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(collection.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when protected official state changes", async () => {
    const collection = collectionService();
    let captures = 0;
    await expect(runGitHubShadowProof({
      service: collection.service,
      allowedAccountId: 61_040_544,
      appId: "1",
      privateKey: appPrivateKey,
      approvedSecurityWorkflowIds: [31],
      fetchImpl: providerFetch() as typeof fetch,
      requestKey: "manual:shadow-proof-state-delta",
      inspectLocalTarget: async () => "supabase_db_compliancehub",
      loadScope: async () => [selectedScope],
      captureProtectedState: async () => protectedState(captures++ === 0 ? "0" : "1"),
      inspectShadowOutcome: async () => persistedOutcome(collection),
    })).rejects.toThrow("GitHub shadow proof invariant failed");
  });

  it("rejects a protected-state delta introduced only after the repeat run", async () => {
    const collection = collectionService();
    let captures = 0;
    await expect(runGitHubShadowProof({
      service: collection.service,
      allowedAccountId: 61_040_544,
      appId: "1",
      privateKey: appPrivateKey,
      approvedSecurityWorkflowIds: [31],
      fetchImpl: providerFetch() as typeof fetch,
      requestKey: "manual:shadow-proof-after-state-delta",
      inspectLocalTarget: async () => "supabase_db_compliancehub",
      loadScope: async () => [selectedScope],
      captureProtectedState: async () => protectedState(captures++ < 2 ? "0" : "1"),
      inspectShadowOutcome: async (targetRunId) => persistedOutcome(collection, targetRunId),
    })).rejects.toThrow("GitHub shadow proof invariant failed");
  });

  it("rejects a repeat run whose stable observation semantics differ", async () => {
    const collection = collectionService();
    await expect(runGitHubShadowProof({
      service: collection.service,
      allowedAccountId: 61_040_544,
      appId: "1",
      privateKey: appPrivateKey,
      approvedSecurityWorkflowIds: [31],
      fetchImpl: providerFetch() as typeof fetch,
      requestKey: "manual:shadow-proof-semantic-delta",
      inspectLocalTarget: async () => "supabase_db_compliancehub",
      loadScope: async () => [selectedScope],
      captureProtectedState: async () => protectedState(),
      inspectShadowOutcome: async (targetRunId) => {
        const outcome = persistedOutcome(collection, targetRunId);
        if (targetRunId === repeatRunId) outcome.observations[0]!.fingerprint = "b".repeat(64);
        return outcome;
      },
    })).rejects.toThrow("GitHub shadow proof invariant failed");
  });

  it("rejects a repository fingerprint delta", async () => {
    const collection = collectionService();
    const fetchImpl = providerFetch();
    let headReads = 0;
    fetchImpl.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname === "/repos/mukta2701/ComplianceHub/git/ref/heads/main" && headReads++ >= 1) {
        return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: "b".repeat(40) } });
      }
      return providerFetch().getMockImplementation()!(input);
    });
    await expect(runGitHubShadowProof({
      service: collection.service,
      allowedAccountId: 61_040_544,
      appId: "1",
      privateKey: appPrivateKey,
      approvedSecurityWorkflowIds: [31],
      fetchImpl: fetchImpl as typeof fetch,
      requestKey: "manual:shadow-proof-fingerprint-delta",
      inspectLocalTarget: async () => "supabase_db_compliancehub",
      loadScope: async () => [selectedScope],
      captureProtectedState: async () => protectedState(),
      inspectShadowOutcome: async () => persistedOutcome(collection),
    })).rejects.toThrow("GitHub shadow proof invariant failed");
  });

  it("rejects a repository fingerprint delta visible only between the two runs", async () => {
    const collection = collectionService();
    const fetchImpl = providerFetch();
    const stableProvider = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (
        url.pathname === "/repos/mukta2701/ComplianceHub/git/ref/heads/main"
        && collection.observations.length === 15
      ) {
        return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: "b".repeat(40) } });
      }
      return stableProvider(input);
    });

    await expect(runGitHubShadowProof({
      service: collection.service,
      allowedAccountId: 61_040_544,
      appId: "1",
      privateKey: appPrivateKey,
      approvedSecurityWorkflowIds: [31],
      fetchImpl: fetchImpl as typeof fetch,
      requestKey: "manual:shadow-proof-midpoint-fingerprint-delta",
      inspectLocalTarget: async () => "supabase_db_compliancehub",
      loadScope: async () => [selectedScope],
      captureProtectedState: async () => protectedState(),
      inspectShadowOutcome: async (targetRunId) => persistedOutcome(collection, targetRunId),
    })).rejects.toThrow("GitHub shadow proof invariant failed");
  });

  it.each([
    ["duplicate check ID", (value: ReturnType<typeof persistedOutcome>) => { value.observations[0]!.checkId = EXPECTED_GITHUB_CHECK_IDS[1]; }],
    ["wrong rule version", (value: ReturnType<typeof persistedOutcome>) => { value.observations[0]!.ruleVersion = "github-repository-v2"; }],
    ["wrong fingerprint shape", (value: ReturnType<typeof persistedOutcome>) => { value.observations[0]!.fingerprint = "A".repeat(64); }],
    ["invalid freshness", (value: ReturnType<typeof persistedOutcome>) => { value.observations[0]!.freshUntil = String(value.observations[0]!.observedAt); }],
    ["wrong run ancestry", (value: ReturnType<typeof persistedOutcome>) => { value.observations[0]!.collectionRunId = "00000000-0000-4000-8000-000000000099"; }],
    ["diagnostic on known result", (value: ReturnType<typeof persistedOutcome>) => { value.observations[0]!.diagnosticCode = "permission_denied"; }],
    ["stale observation timestamp", (value: ReturnType<typeof persistedOutcome>) => {
      value.observations[0]!.observedAt = "2026-01-01T00:00:00.000Z";
      value.observations[0]!.freshUntil = "2026-01-02T12:00:00.000Z";
    }],
  ])("rejects persisted shadow observations with %s", async (_label, mutate) => {
    const collection = collectionService();
    await expect(runGitHubShadowProof({
      service: collection.service,
      allowedAccountId: 61_040_544,
      appId: "1",
      privateKey: appPrivateKey,
      approvedSecurityWorkflowIds: [31],
      fetchImpl: providerFetch() as typeof fetch,
      requestKey: "manual:shadow-proof-invalid-observation",
      inspectLocalTarget: async () => "supabase_db_compliancehub",
      loadScope: async () => [selectedScope],
      captureProtectedState: async () => protectedState(),
      inspectShadowOutcome: async () => {
        const value = persistedOutcome(collection);
        mutate(value);
        return value;
      },
    })).rejects.toThrow("GitHub shadow proof invariant failed");
  });
});

describe("writeGitHubShadowProofFile", () => {
  it("rejects secret-like or structurally unexpected output", async () => {
    await expect(writeGitHubShadowProofFile({ token: privateCredentialFixture }, tmpdir())).rejects.toThrow("GitHub shadow proof output denied");
  });
});
