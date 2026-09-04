import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import * as proofHarness from "../../../../scripts/mcp-github-read-proof";
import * as ownedLauncher from "../../../../scripts/mcp-proof-owned-server";
import {
  buildPhase3Proof,
  buildProtectedDomainSnapshotQuery,
  buildReconciliationQuery,
  buildWorkspaceSelectionQuery,
  buildProtectedDomainSnapshot,
  PROTECTED_DOMAIN_TABLES,
  createAcceptanceAnswers,
  deriveExpectedOfficialResults,
  assertLocalAuthorizationUrl,
  inspectStaticServerCallPath,
  reconcileOfficialResults,
  selectProofProtocol,
  requireLocalPostgresSettings,
  parseProtectedDomainDigest,
  parseWorkspaceSelection,
  validateDockerIdentity,
  validateLocalDockerContext,
  validateProofForPersistence,
  writeProofArtifact,
  type GitHubProofResult,
} from "../../../../scripts/mcp-github-read-proof";

const execFileAsync = promisify(execFile);

function result(index: number, override: Partial<GitHubProofResult>): GitHubProofResult {
  const suffix = String(index).padStart(12, "0");
  return {
    id: `github_result:10000000-0000-4000-8000-${suffix}`,
    repositoryId: "40000000-0000-4000-8000-000000000001",
    repositoryLabel: "GitHub repository 40000000",
    collectionRunId: `github_run:70000000-0000-4000-8000-${suffix}`,
    runMode: "official",
    checkId: "github.branch.protection",
    result: "pass",
    severity: null,
    observedAt: "2026-09-03T15:00:00.000Z",
    freshUntil: "2026-09-04T16:00:00.000Z",
    materialisedAt: "2026-09-03T15:01:00.000Z",
    freshness: "current",
    mappingVersion: "iso-v1",
    mappingChecksum: "a".repeat(64),
    mappingStatus: "active",
    ruleVersion: "rule-v1",
    sourceResponseFingerprint: "b".repeat(64),
    summary: "The approved result was returned.",
    evidenceId: `evidence:90000000-0000-4000-8000-${suffix}`,
    findingId: null,
    recordHash: "c".repeat(64),
    ...override,
  };
}

const results: GitHubProofResult[] = [
  result(1, { result: "fail", severity: "high", evidenceId: null, findingId: "monitoring_finding:a0000000-0000-4000-8000-000000000001", summary: "The approved check found that branch protection needs attention." }),
  result(2, { checkId: "github.code_scanning", result: "unknown", evidenceId: null, summary: "The approved check could not verify code scanning." }),
  result(3, { checkId: "github.dependabot", freshness: "stale", summary: "The approved result needs to be checked again." }),
];

function protectedRows(overrides: Record<string, unknown[]> = {}) {
  return {
    ...Object.fromEntries(Object.keys(PROTECTED_DOMAIN_TABLES).map((domain) => [domain, []])),
    ...overrides,
  };
}

const domainSnapshot = buildProtectedDomainSnapshot(protectedRows({
  githubOfficialResults: [{ id: "row-1", status: "current" }],
  evidence: [{ id: "evidence-1", status: "active" }],
}));

function validProof() {
  return buildPhase3Proof({
    generatedAt: "2026-09-03T16:00:00.000Z",
    endpoint: "http://127.0.0.1:3100/mcp",
    negotiatedProtocol: "2026-07-28",
    oauth: {
      discovery: true,
      dynamicClientRegistration: true,
      grant: "authorization-code",
      pkce: "S256",
      stateValidated: true,
      consent: "approved",
      audienceMatched: true,
    },
    server: { name: "compliancehub-internal", version: "0.4.0", initialized: true },
    tools: [
      "list_workspaces", "get_compliance_overview", "list_attention_items",
      "list_monitoring_findings", "list_github_compliance_results",
      "get_latest_leadership_report", "prepare_daily_digest",
    ].map((name) => ({ name, readOnly: true, destructive: false, openWorld: false, idempotent: true })) as never,
    workspaceRead: true,
    githubRead: {
      readOnly: true,
      destructive: false,
      openWorld: false,
      limit: 1,
      pages: [
        { pageKind: "initial", resultCount: 1, hasNextPage: true },
        { pageKind: "continuation", resultCount: 1, hasNextPage: true },
        { pageKind: "continuation", resultCount: 1, hasNextPage: false },
      ],
      traversedToNull: true,
      totalResults: results.length,
    },
    databaseUnchanged: true,
    protectedStateBracket: {
      workspaceSelectedAt: "2026-09-03T15:59:58.000Z",
      baselineCapturedAt: "2026-09-03T15:59:59.000Z",
      workflowStartedAt: "2026-09-03T16:00:00.000Z",
      workflowCompletedAt: "2026-09-03T16:00:01.000Z",
      afterCapturedAt: "2026-09-03T16:00:02.000Z",
      baselineBeforeWorkflow: true,
      afterAfterWorkflow: true,
    },
    database: {
      scope: "tenant-compliance-state-plus-global-github-mapping-catalogue",
      before: domainSnapshot,
      after: domainSnapshot,
      unchanged: true,
      reconciliation: {
        mcpResultCount: 3,
        databaseResultCount: 3,
        matched: true,
        resultSetHash: "a".repeat(64),
      },
    },
    observations: {
      clientNetwork: { scope: "proof-client-process", loopbackOnly: true, githubCalls: 0, slackCalls: 0 },
      serverNetwork: { scope: "dedicated-server-process", guardActive: true, githubAttempts: 0, slackAttempts: 0 },
      invokedTools: { listWorkspaces: 1, githubReadPages: 3, writeTools: [] },
      staticServerCallPath: { scope: "reviewed-source", databaseReadOnly: true, githubProviderReachable: false, slackWriteReachable: false },
    },
    answers: createAcceptanceAnswers(results),
  });
}

describe("Phase 3 local MCP foundation proof", () => {
  it("accepts only a live launcher-owned guarded server for the exact unpredictable run", () => {
    const validate = (proofHarness as unknown as {
      validateOwnedServerState?: (input: unknown) => unknown;
    }).validateOwnedServerState;
    expect(validate).toBeTypeOf("function");
    if (!validate) return;
    const runId = "A".repeat(43);
    const valid = {
      expectedRunId: runId,
      control: {
        schemaVersion: 1, runId, status: "ready", port: 3100,
        launcherPid: 101, childPid: 102, listenerPid: 103,
      },
      ledger: { schemaVersion: 1, runId, guardActive: true },
      currentListenerPid: 103,
      liveProcessIds: [101, 102, 103],
      parentByPid: { 102: 101, 103: 102 },
      activationPids: [102, 103],
      providerEvents: [],
      launcherCommand: "node scripts/mcp-proof-owned-server.ts",
    };

    expect(validate(valid)).toEqual({ guardActive: true, githubAttempts: 0, slackAttempts: 0 });
    const rejected = [
      { ...valid, expectedRunId: "B".repeat(43) },
      { ...valid, ledger: { ...valid.ledger, runId: "B".repeat(43) } },
      { ...valid, liveProcessIds: [101, 103] },
      { ...valid, parentByPid: { 102: 101, 103: 999 } },
      { ...valid, currentListenerPid: 104 },
      { ...valid, activationPids: [102] },
      { ...valid, launcherCommand: "node arbitrary-server.ts" },
    ];
    for (const candidate of rejected) expect(() => validate(candidate)).toThrow(/owned guarded server/i);
  });

  it("refuses to launch while any process already owns the exact proof port", () => {
    const assertCanClaim = (proofHarness as unknown as {
      assertLauncherCanClaimPort?: (listenerPids: number[]) => void;
    }).assertLauncherCanClaimPort;
    expect(assertCanClaim).toBeTypeOf("function");
    if (!assertCanClaim) return;
    expect(() => assertCanClaim([])).not.toThrow();
    expect(() => assertCanClaim([333])).toThrow(/another listener/i);
  });

  it("removes private state after early setup failure without replacing the primary error", async () => {
    const runLifecycle = (ownedLauncher as unknown as {
      runOwnedProofLifecycle?: <T>(input: {
        operation: () => Promise<T>;
        stopOwnedChild: () => Promise<void>;
        verifyPortReleased: () => Promise<void>;
        removePrivateState: () => Promise<void>;
      }) => Promise<T>;
    }).runOwnedProofLifecycle;
    expect(runLifecycle).toBeTypeOf("function");
    if (!runLifecycle) return;
    const directory = await mkdtemp(join(tmpdir(), "compliancehub-mcp-cleanup-"));
    const primary = new Error("early setup failed");

    await expect(runLifecycle({
      operation: async () => { throw primary; },
      stopOwnedChild: async () => undefined,
      verifyPortReleased: async () => undefined,
      removePrivateState: async () => rm(directory, { recursive: true, force: true }),
    })).rejects.toBe(primary);
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes private state even when owned shutdown and port-release verification both fail", async () => {
    const runLifecycle = (ownedLauncher as unknown as {
      runOwnedProofLifecycle?: <T>(input: {
        operation: () => Promise<T>;
        stopOwnedChild: () => Promise<void>;
        verifyPortReleased: () => Promise<void>;
        removePrivateState: () => Promise<void>;
      }) => Promise<T>;
    }).runOwnedProofLifecycle;
    expect(runLifecycle).toBeTypeOf("function");
    if (!runLifecycle) return;
    const directory = await mkdtemp(join(tmpdir(), "compliancehub-mcp-cleanup-"));
    const attempted: string[] = [];

    await expect(runLifecycle({
      operation: async () => "proof-complete",
      stopOwnedChild: async () => { attempted.push("owned-stop"); throw new Error("shutdown failed"); },
      verifyPortReleased: async () => { attempted.push("port-check"); throw new Error("foreign listener"); },
      removePrivateState: async () => { attempted.push("private-remove"); await rm(directory, { recursive: true, force: true }); },
    })).rejects.toThrow(/cleanup/i);
    expect(attempted).toEqual(["owned-stop", "port-check", "private-remove"]);
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("captures the complete read-only contract without persisting an opaque cursor", () => {
    const proof = validProof();

    expect(proof.endpoint).toBe("http://127.0.0.1:3100/mcp");
    expect(proof.protocols).toEqual({ current: "2026-07-28", legacy: "2025-11-25" });
    expect(proof.tools.every((tool) => tool.readOnly)).toBe(true);
    expect(proof.tools.some((tool) => String(tool.name) === "post_daily_digest")).toBe(false);
    expect(proof.databaseUnchanged).toBe(true);
    expect(proof.oauth.pkce).toBe("S256");
    expect(proof.oauth.audienceMatched).toBe(true);
    expect(proof.githubRead.readOnly).toBe(true);
    expect(proof.githubRead.pages.map((page) => page.hasNextPage)).toEqual([true, true, false]);
    expect(proof.githubRead.traversedToNull).toBe(true);
    expect(proof.database.reconciliation.matched).toBe(true);
    expect(proof.database.scope).toBe("tenant-compliance-state-plus-global-github-mapping-catalogue");
    expect(PROTECTED_DOMAIN_TABLES).toMatchObject({
      githubMappingPacks: "github_mapping_packs",
      githubMappingEntries: "github_mapping_entries",
    });
    expect(proof.database.unchanged).toBe(true);
    expect(proof.observations.clientNetwork).toEqual({
      scope: "proof-client-process",
      loopbackOnly: true,
      githubCalls: 0,
      slackCalls: 0,
    });
    expect(proof.observations.invokedTools.writeTools).toEqual([]);
    expect(proof.observations.staticServerCallPath).toEqual({
      scope: "reviewed-source",
      databaseReadOnly: true,
      githubProviderReachable: false,
      slackWriteReachable: false,
    });
    expect(JSON.stringify(proof)).not.toMatch(/cursor/i);
    expect(proof.protectedStateBracket).toMatchObject({ baselineBeforeWorkflow: true, afterAfterWorkflow: true });
    expect(Date.parse(proof.protectedStateBracket.baselineCapturedAt)).toBeLessThanOrEqual(Date.parse(proof.protectedStateBracket.workflowStartedAt));
    expect(Date.parse(proof.protectedStateBracket.workflowCompletedAt)).toBeLessThanOrEqual(Date.parse(proof.protectedStateBracket.afterCapturedAt));
    expect(proof.observations.serverNetwork).toEqual({
      scope: "dedicated-server-process", guardActive: true, githubAttempts: 0, slackAttempts: 0,
    });
    expect(() => validateProofForPersistence(proof)).not.toThrow();
  });

  it("selects only the explicit current or legacy proof client contract", () => {
    expect(selectProofProtocol({ MCP_PROOF_PROTOCOL: "current" })).toBe("2026-07-28");
    expect(selectProofProtocol({ MCP_PROOF_PROTOCOL: "legacy" })).toBe("2025-11-25");
    expect(() => selectProofProtocol({})).toThrow(/MCP_PROOF_PROTOCOL/i);
    expect(() => selectProofProtocol({ MCP_PROOF_PROTOCOL: "auto" })).toThrow(/MCP_PROOF_PROTOCOL/i);
  });

  it("answers only from MCP facts and refuses change-history and certification claims", () => {
    const answers = createAcceptanceAnswers(results);

    expect(answers).toHaveLength(5);
    expect(answers[0]?.answer).toContain("github.branch.protection");
    expect(answers[1]?.answer).toContain("github.code_scanning");
    expect(answers[2]?.answer).toContain("github.dependabot");
    expect(answers[3]).toMatchObject({ supported: false });
    expect(answers[3]?.answer).toMatch(/does not include verified change history/i);
    expect(answers[4]).toMatchObject({ supported: true });
    expect(answers[4]?.answer).toMatch(/^No\b.*does not prove ISO 27001 certification/i);
  });

  it("rejects secret-bearing artifacts and writes accepted proof owner-only", async () => {
    const proof = validProof();
    const prohibitedAccessField = ["access", "token"].join("_");
    const prohibitedServiceField = ["service", "role", "key"].join("_");
    const prohibitedEmailField = ["email"].join("");
    const prohibitedProviderField = ["provider", "payload"].join("_");
    const prohibitedCredentialField = ["credential"].join("");
    const prohibitedDestinationField = ["destination"].join("");
    const prohibitedWebhookField = ["webhook", "url"].join("_");
    const prohibitedValue = ["not", "persistable"].join("-");
    expect(() => validateProofForPersistence({ ...proof, leaked: `Bearer ${prohibitedValue}` })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, cursor: "ch4.full-opaque-cursor" })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, nextCursorHash: "a".repeat(12) })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, nested: { cursorDerived: false } })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, [prohibitedAccessField]: prohibitedValue })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, [prohibitedServiceField]: prohibitedValue })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, [prohibitedEmailField]: ["person", "example.test"].join("@") })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, [prohibitedProviderField]: prohibitedValue })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, [prohibitedCredentialField]: prohibitedValue })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, [prohibitedDestinationField]: prohibitedValue })).toThrow(/sensitive/i);
    expect(() => validateProofForPersistence({ ...proof, [prohibitedWebhookField]: prohibitedValue })).toThrow(/sensitive/i);

    const directory = await mkdtemp(join(tmpdir(), "compliancehub-mcp-proof-"));
    const output = join(directory, "proof.json");
    await writeProofArtifact(output, proof);

    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(proof);
  });

  it("fails closed when the local database has no official Phase 1 results", () => {
    const proof = validProof();
    const empty = {
      ...proof,
      githubRead: {
        ...proof.githubRead,
        pages: [{ pageKind: "initial" as const, resultCount: 0, hasNextPage: false }],
        totalResults: 0,
      },
      database: {
        ...proof.database,
        reconciliation: {
          mcpResultCount: 0,
          databaseResultCount: 0,
          matched: true as const,
          resultSetHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      },
    };

    expect(() => validateProofForPersistence(empty)).toThrow(/official Phase 1 result/i);
  });

  it("independently derives the eligible terminal latest-result set from stored table rows", () => {
    const snapshotAt = "2026-09-03T16:00:00.000Z";
    const base = {
      organisation_id: "20000000-0000-4000-8000-000000000001",
      installation_id: "30000000-0000-4000-8000-000000000001",
      repository_id: "40000000-0000-4000-8000-000000000001",
      provider_repository_id: 42,
      mapping_pack_id: "50000000-0000-4000-8000-000000000001",
      mapping_version: "iso-v1",
      mapping_checksum: "a".repeat(64),
      approval_id: "60000000-0000-4000-8000-000000000001",
      check_id: "github.branch.protection",
      fresh_until: "2026-09-04T16:00:00.000Z",
    };
    const officialRows = [
      { ...base, id: "10000000-0000-4000-8000-000000000001", collection_run_id: "70000000-0000-4000-8000-000000000001", observation_id: "80000000-0000-4000-8000-000000000001", observed_at: "2026-09-03T14:00:00.000Z", materialised_at: "2026-09-03T14:01:00.000Z" },
      { ...base, id: "10000000-0000-4000-8000-000000000002", collection_run_id: "70000000-0000-4000-8000-000000000002", observation_id: "80000000-0000-4000-8000-000000000002", observed_at: "2026-09-03T15:00:00.000Z", materialised_at: "2026-09-03T15:01:00.000Z" },
      { ...base, id: "10000000-0000-4000-8000-000000000003", collection_run_id: "70000000-0000-4000-8000-000000000003", observation_id: "80000000-0000-4000-8000-000000000003", observed_at: "2026-09-03T15:30:00.000Z", materialised_at: "2026-09-03T16:01:00.000Z" },
      { ...base, id: "10000000-0000-4000-8000-000000000004", collection_run_id: "70000000-0000-4000-8000-000000000004", observation_id: "80000000-0000-4000-8000-000000000004", observed_at: "2026-09-03T15:45:00.000Z", materialised_at: "2026-09-03T15:46:00.000Z" },
    ];
    const observations = officialRows.map((row) => ({
      id: row.observation_id,
      organisation_id: row.organisation_id,
      installation_id: row.installation_id,
      repository_id: row.repository_id,
      provider_repository_id: row.provider_repository_id,
      collection_run_id: row.collection_run_id,
      fingerprint: "b".repeat(64),
    }));
    const runs = officialRows.map((row, index) => ({
      id: row.collection_run_id,
      organisation_id: row.organisation_id,
      installation_id: row.installation_id,
      repository_id: row.repository_id,
      provider_repository_id: row.provider_repository_id,
      run_mode: index === 3 ? "shadow" : "official",
      status: "succeeded",
      completed_at: "2026-09-03T15:50:00.000Z",
    }));
    const approvals = [{ id: base.approval_id, organisation_id: base.organisation_id, mapping_pack_id: base.mapping_pack_id, approved_at: "2026-09-01T00:00:00.000Z", revoked_at: null }];
    const packs = [{ id: base.mapping_pack_id, version: base.mapping_version, checksum: base.mapping_checksum, published_at: "2026-09-01T00:00:00.000Z" }];

    expect(deriveExpectedOfficialResults({
      officialRows: officialRows.map((row) => ({
        ...row,
        outcome: "fail",
        failure_severity: "high",
        rule_version: "rule-v1",
        catalogue_summary: "The approved check found that branch protection needs attention.",
        evidence_id: null,
        finding_id: "a0000000-0000-4000-8000-000000000001",
      })),
      observations,
      runs,
      approvals,
      packs,
      snapshotAt,
    })).toEqual([{
      id: "github_result:10000000-0000-4000-8000-000000000002",
      repositoryId: base.repository_id,
      repositoryLabel: "GitHub repository 40000000",
      collectionRunId: "github_run:70000000-0000-4000-8000-000000000002",
      runMode: "official",
      checkId: "github.branch.protection",
      result: "fail",
      severity: "high",
      observedAt: "2026-09-03T15:00:00.000Z",
      freshUntil: "2026-09-04T16:00:00.000Z",
      materialisedAt: "2026-09-03T15:01:00.000Z",
      freshness: "current",
      mappingVersion: "iso-v1",
      mappingChecksum: "a".repeat(64),
      mappingStatus: "active",
      ruleVersion: "rule-v1",
      sourceResponseFingerprint: "b".repeat(64),
      summary: "The approved check found that branch protection needs attention.",
      evidenceId: null,
      findingId: "monitoring_finding:a0000000-0000-4000-8000-000000000001",
    }]);
  });

  it("rejects an MCP outcome that disagrees with the independently stored result", () => {
    const expected = results.map(({ recordHash: _recordHash, ...row }) => {
      void _recordHash;
      return row;
    });

    expect(reconcileOfficialResults(results, expected)).toMatchObject({ matched: true });
    expect(reconcileOfficialResults([
      { ...results[0]!, result: "unknown", severity: null, findingId: null },
      ...results.slice(1),
    ], expected)).toMatchObject({ matched: false });
  });

  it("detects protected-domain updates even when every table keeps the same row count", () => {
    const before = buildProtectedDomainSnapshot(protectedRows({ evidence: [{ id: "row-1", status: "active" }] }));
    const after = buildProtectedDomainSnapshot(protectedRows({ evidence: [{ id: "row-1", status: "withdrawn" }] }));
    expect(before.evidence.rowCount).toBe(after.evidence.rowCount);
    expect(before.evidence.sha256).not.toBe(after.evidence.sha256);

    const proof = validProof();
    expect(() => validateProofForPersistence({
      ...proof,
      database: { ...proof.database, before, after, unchanged: true },
    })).toThrow(/snapshot/i);
  });

  it("fails closed on internally contradictory pagination, counts, versions, and answers", () => {
    const proof = validProof();
    const cases: unknown[] = [
      { ...proof, server: { ...proof.server, version: "0.2.0" } },
      { ...proof, negotiatedProtocol: "2026-01-01" },
      { ...proof, protocols: { current: "2026-07-28", legacy: "2025-03-26" } },
      { ...proof, tools: proof.tools.slice(0, -1) },
      { ...proof, tools: proof.tools.map((tool, index) => index === 0 ? { ...tool, readOnly: false } : tool) },
      { ...proof, databaseUnchanged: false },
      { ...proof, protectedStateBracket: { ...proof.protectedStateBracket, baselineCapturedAt: "2026-09-03T16:00:01.000Z" } },
      { ...proof, protectedStateBracket: { ...proof.protectedStateBracket, afterCapturedAt: "2026-09-03T16:00:00.000Z" } },
      { ...proof, observations: { ...proof.observations, serverNetwork: { ...proof.observations.serverNetwork, githubAttempts: 1 } } },
      { ...proof, githubRead: { ...proof.githubRead, totalResults: 2 } },
      { ...proof, githubRead: { ...proof.githubRead, pages: [
        proof.githubRead.pages[0],
        { ...proof.githubRead.pages[1], pageKind: "initial" },
        proof.githubRead.pages[2],
      ] } },
      { ...proof, database: { ...proof.database, reconciliation: { ...proof.database.reconciliation, databaseResultCount: 2 } } },
      { ...proof, database: { ...proof.database, reconciliation: { ...proof.database.reconciliation, matched: false } } },
      { ...proof, database: { ...proof.database, after: buildProtectedDomainSnapshot(protectedRows({ evidence: [{ id: "changed" }] })) } },
      { ...proof, observations: { ...proof.observations, invokedTools: { ...proof.observations.invokedTools, githubReadPages: 2 } } },
      { ...proof, githubRead: { ...proof.githubRead, pages: proof.githubRead.pages.map((page, index) => index === 0 ? { ...page, hasNextPage: false } : page) } },
      { ...proof, answers: proof.answers.map((answer, index) => index === 4 ? { ...answer, answer: "Yes, certified." } : answer) },
    ];

    for (const candidate of cases) expect(() => validateProofForPersistence(candidate)).toThrow();
  });

  it("accepts only the exact local authorization-server URL before browser handoff", () => {
    const supabaseUrl = new URL("http://127.0.0.1:54321");
    expect(() => assertLocalAuthorizationUrl(
      new URL("http://127.0.0.1:54321/auth/v1/oauth/authorize?client_id=local"),
      supabaseUrl,
    )).not.toThrow();
    expect(() => assertLocalAuthorizationUrl(
      new URL("https://attacker.example/auth/v1/oauth/authorize?client_id=local"),
      supabaseUrl,
    )).toThrow(/authorization URL/i);
    expect(() => assertLocalAuthorizationUrl(
      new URL("http://localhost:54321/auth/v1/oauth/authorize?client_id=local"),
      supabaseUrl,
    )).toThrow(/authorization URL/i);
  });

  it("records static server call-path evidence separately from client network observations", async () => {
    await expect(inspectStaticServerCallPath()).resolves.toEqual({
      scope: "reviewed-source",
      databaseReadOnly: true,
      githubProviderReachable: false,
      slackWriteReachable: false,
    });
  });

  it("atomically records string, URL, and Request provider attempts while allowing loopback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "compliancehub-mcp-server-network-"));
    const ledger = join(directory, "ledger.json");
    const events = `${ledger}.events`;
    const runId = "A".repeat(43);
    await mkdir(events, { mode: 0o700 });
    await writeFile(ledger, `${JSON.stringify({ schemaVersion: 1, runId, guardActive: true })}\n`, { mode: 0o600 });
    const guard = join(process.cwd(), "scripts/mcp-proof-server-network-guard.cjs");
    const server = createServer((_request, response) => { response.writeHead(204); response.end(); });
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback test server did not bind.");
    try {
      const child = [
        "await fetch(process.argv[1])",
        "const githubUrl = new URL(\"https://api.github.com/user\")",
        "const githubRequest = new Request(\"https://github.com/settings\")",
        "const slackRequest = new Request(\"https://hooks.slack.com/services/test\")",
        "const slackString = \"https://slack.com/api/test\"",
        "for (const target of [githubUrl, githubRequest, slackRequest, slackString]) {",
        "  try { await fetch(target) } catch {}",
        "}",
      ].join(";");
      await execFileAsync(process.execPath, [
        "--require", guard, "--input-type=module", "--eval", child, `http://127.0.0.1:${address.port}/health`,
      ], {
        env: {
          ...process.env,
          MCP_PROOF_SERVER_NETWORK_LEDGER: ledger,
          MCP_PROOF_SERVER_RUN_ID: runId,
        },
      });
    } finally {
      await new Promise<void>((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
    }
    expect(JSON.parse(await readFile(ledger, "utf8"))).toEqual({ schemaVersion: 1, runId, guardActive: true });
    expect((await stat(ledger)).mode & 0o777).toBe(0o600);
    const eventFiles = await readdir(events);
    const eventRecords = await Promise.all(eventFiles.map(async (file) => {
      expect((await stat(join(events, file))).mode & 0o777).toBe(0o600);
      return JSON.parse(await readFile(join(events, file), "utf8"));
    }));
    expect(eventRecords.filter((event) => event.kind === "activation")).toHaveLength(1);
    expect(eventRecords.filter((event) => event.kind === "provider-attempt").map((event) => event.provider)).toEqual([
      "github", "github", "slack", "slack",
    ]);
  });

  it("requires an exact local Docker/PostgreSQL boundary and never reconciles through REST or the v2 RPC", async () => {
    expect(requireLocalPostgresSettings({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      MCP_PROOF_DB_CONTAINER: "supabase_db_compliancehub",
    })).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      databaseContainer: "supabase_db_compliancehub",
    });
    expect(() => requireLocalPostgresSettings({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      MCP_PROOF_DB_CONTAINER: "supabase_db_compliancehub",
    })).toThrow(/local/i);
    expect(() => requireLocalPostgresSettings({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      MCP_PROOF_DB_CONTAINER: "supabase_db_compliancehub; rm -rf",
    })).toThrow(/container/i);
    expect(() => requireLocalPostgresSettings({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      DOCKER_HOST: "tcp://remote.example:2375",
    })).toThrow(/remote Docker/i);

    expect(() => validateLocalDockerContext({ contextName: "remote", host: "tcp://remote.example:2375" })).toThrow(/local Unix/i);
    expect(() => validateLocalDockerContext({ contextName: "colima", host: "unix:///Users/test/.colima/default/docker.sock" })).not.toThrow();
    const identity = {
      name: "/supabase_db_compliancehub",
      running: true,
      image: "public.ecr.aws/supabase/postgres:15.8.1.085",
      composeProject: "compliancehub",
      supabaseProject: "compliancehub",
      networks: ["supabase_network_compliancehub"],
      aliases: ["db", "db.supabase.internal"],
    };
    expect(() => validateDockerIdentity(identity, "supabase_db_compliancehub")).not.toThrow();
    expect(() => validateDockerIdentity({ ...identity, composeProject: "attacker" }, "supabase_db_compliancehub")).toThrow(/identity/i);
    expect(() => validateDockerIdentity({ ...identity, networks: ["bridge"] }, "supabase_db_compliancehub")).toThrow(/network/i);

    const source = await readFile(join(process.cwd(), "scripts/mcp-github-read-proof.ts"), "utf8");
    expect(source).not.toMatch(/\.rpc\s*\(\s*["']get_mcp_github_compliance_results_v2["']/);
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("createClient(");
    expect(source).toContain("execFile(");
    expect(source).not.toContain("shell: true");
    expect(source).not.toContain("authorizationUrl.toString()}\\n");
  });

  it("uses atomic read-only SQL and returns only protected-domain digests", () => {
    const workspaceId = "20000000-0000-4000-8000-000000000001";
    for (const query of [buildProtectedDomainSnapshotQuery(workspaceId), buildReconciliationQuery(workspaceId)]) {
      expect(query).toMatch(/begin transaction read only/i);
      expect(query).toMatch(/current_setting\('transaction_read_only'\)/i);
      expect(query).not.toMatch(/select\s+\*/i);
      expect(query).toMatch(/commit/i);
    }
    expect(() => buildProtectedDomainSnapshotQuery("' OR true; --")).toThrow();
    expect(() => buildReconciliationQuery("' OR true; --")).toThrow();

    const digest = Object.fromEntries(Object.keys(PROTECTED_DOMAIN_TABLES).map((domain) => [
      domain,
      { rowCount: 0, sha256: "e".repeat(64) },
    ]));
    expect(parseProtectedDomainDigest(JSON.stringify({ readOnly: true, scope: "tenant-compliance-state-plus-global-github-mapping-catalogue", tables: digest }))).toEqual(digest);
    expect(() => parseProtectedDomainDigest(JSON.stringify({ readOnly: true, tables: { evidence: { rows: [{ access_token: "secret" }] } } }))).toThrow(/digest/i);
  });

  it("selects one proof workspace by direct read-only local database lookup before the protected baseline", () => {
    const workspaceId = "20000000-0000-4000-8000-000000000001";
    const unrestricted = buildWorkspaceSelectionQuery();
    const requested = buildWorkspaceSelectionQuery(workspaceId);
    for (const query of [unrestricted, requested]) {
      expect(query).toMatch(/begin transaction read only/i);
      expect(query).toMatch(/github_official_compliance_results/i);
      expect(query).not.toMatch(/select\s+\*/i);
      expect(query).toMatch(/commit/i);
    }
    expect(requested).toContain(`'${workspaceId}'::uuid`);
    expect(parseWorkspaceSelection({ readOnly: true, workspaceIds: [workspaceId] })).toBe(workspaceId);
    expect(() => parseWorkspaceSelection({ readOnly: true, workspaceIds: [] })).toThrow(/exactly one/i);
    expect(() => parseWorkspaceSelection({ readOnly: true, workspaceIds: [workspaceId, "20000000-0000-4000-8000-000000000002"] })).toThrow(/exactly one/i);
    expect(() => buildWorkspaceSelectionQuery("' OR true; --")).toThrow();
  });
});
