// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertApprovedLocalContainerIdentity,
  assertExpectedCollection,
  assertExpectedOfficialResults,
  assertExpectedReconciliation,
  buildProtectedStateProof,
  harnessSourceHashes,
  localContainerInspectArgs,
  localProtectedStateSql,
  mappingApprovalLineageHash,
  parseReadOnlyJsonOutput,
  parseApprovedWorkflowIds,
  requireLocalRuntimeConfig,
  runControlledRepeatability,
  selectExactlyOneActivePublishedApproval,
  selectExactlyOneSelectedRepository,
  selectExactlyOneInstallation,
  terminalRunLineageHash,
} from "../../scripts/local-github-repeatability";

const installationId = "11111111-1111-4111-8111-111111111111";
const organisationId = "22222222-2222-4222-8222-222222222222";

describe("local GitHub repeatability harness guards", () => {
  it("runs in the production-compatible Node environment required for GitHub App signing", () => {
    expect(globalThis).not.toHaveProperty("window");
  });

  it("accepts only the exact local Supabase API origin", () => {
    expect(requireLocalRuntimeConfig({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/",
      SUPABASE_SERVICE_ROLE_KEY: "local-service-key",
      GITHUB_ALLOWED_ACCOUNT_ID: "61040544",
      GITHUB_ALLOWED_ACCOUNT_TYPE: "User",
      GITHUB_APP_ID: "4629430",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "1,20",
    }).supabaseUrl).toBe("http://127.0.0.1:54321/");
  });

  it.each([
    "https://127.0.0.1:54321/",
    "http://127.0.0.1:54322/",
    "http://example.test:54321/",
    "http://user:pass@127.0.0.1:54321/",
    "http://127.0.0.1:54321/rest/v1",
    "http://127.0.0.1:54321/?x=1",
  ])("rejects non-exact local API URL %s", (url) => {
    expect(() => requireLocalRuntimeConfig({
      NEXT_PUBLIC_SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: "local-service-key",
      GITHUB_ALLOWED_ACCOUNT_ID: "61040544",
      GITHUB_ALLOWED_ACCOUNT_TYPE: "User",
      GITHUB_APP_ID: "4629430",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "1",
    })).toThrow("Local GitHub repeatability preflight failed");
  });

  it("requires the configured personal User account and canonical unique workflow IDs", () => {
    expect(() => requireLocalRuntimeConfig({
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321/",
      SUPABASE_SERVICE_ROLE_KEY: "local-service-key",
      GITHUB_ALLOWED_ACCOUNT_ID: "61040544",
      GITHUB_ALLOWED_ACCOUNT_TYPE: "Organization",
      GITHUB_APP_ID: "4629430",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "1",
    })).toThrow("Local GitHub repeatability preflight failed");
    expect(() => parseApprovedWorkflowIds("1,01")).toThrow("Local GitHub repeatability preflight failed");
    expect(() => parseApprovedWorkflowIds("1,1")).toThrow("Local GitHub repeatability preflight failed");
    expect(parseApprovedWorkflowIds("1,20")).toEqual([1, 20]);
  });

  it("selects exactly one active Mukta User installation with matching account ID", () => {
    const selected = selectExactlyOneInstallation([{
      id: installationId,
      organisation_id: organisationId,
      account_id: 61040544,
      account_type: "User",
      status: "active",
      permissions_ok: true,
    }], 61040544);
    expect(selected).toMatchObject({ id: installationId, organisation_id: organisationId });

    expect(() => selectExactlyOneInstallation([{
      id: installationId,
      organisation_id: organisationId,
      account_id: 61040544,
      account_type: "Organization",
      status: "active",
      permissions_ok: true,
    }], 61040544)).toThrow("Local GitHub repeatability preflight failed");
  });

  it("requires exactly one selected repository and one published active mapping approval", () => {
    const repository = {
      id: "44444444-4444-4444-8444-444444444444",
      organisation_id: organisationId,
      installation_id: installationId,
      provider_repository_id: 123,
      selected: true,
      available: true,
    };
    expect(selectExactlyOneSelectedRepository([repository], { id: installationId, organisation_id: organisationId })).toEqual(repository);
    expect(() => selectExactlyOneSelectedRepository([repository, { ...repository, id: "55555555-5555-4555-8555-555555555555", provider_repository_id: 456 }], { id: installationId, organisation_id: organisationId }))
      .toThrow("Local GitHub repeatability preflight failed");
    expect(selectExactlyOneActivePublishedApproval([{
      id: "66666666-6666-4666-8666-666666666666",
      organisation_id: organisationId,
      mapping_pack_id: "77777777-7777-4777-8777-777777777777",
      github_mapping_packs: {
        id: "77777777-7777-4777-8777-777777777777",
        version: "github-compliance-v1",
        checksum: "a".repeat(64),
        published_at: "2026-08-29T00:00:00.000Z",
      },
    }], organisationId).id).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("uses a parameterised, read-only local protected-state query", () => {
    expect(localProtectedStateSql).toContain("BEGIN TRANSACTION READ ONLY");
    expect(localProtectedStateSql).toContain(":'org'::uuid");
    expect(localProtectedStateSql).toContain("assessment_responses");
    expect(localProtectedStateSql).toContain("tasks");
    expect(localProtectedStateSql).toContain("non_github_evidence");
    expect(localProtectedStateSql).toContain("non_github_evidence_links");
    expect(localProtectedStateSql).toContain("non_github_monitoring_findings");
    expect(localProtectedStateSql).toContain("alert_channels");
    expect(localProtectedStateSql).toContain("daily_digest_deliveries");
    expect(localProtectedStateSql).toContain("daily_digest_delivery_attempts");
    expect(localProtectedStateSql).not.toMatch(/\b(?:insert|update|delete|alter|drop)\b/i);
    expect(assertApprovedLocalContainerIdentity("true compliancehub")).toBeUndefined();
    expect(() => assertApprovedLocalContainerIdentity("true other-project")).toThrow("Local GitHub repeatability preflight failed");
  });

  it("accepts only one JSON object wrapped by exact read-only transaction markers", () => {
    expect(parseReadOnlyJsonOutput("BEGIN\r\n{\"ok\":true}\r\nCOMMIT\r\n"))
      .toBe("{\"ok\":true}");

    for (const invalid of [
      "{\"ok\":true}\n",
      "BEGIN\n{\"ok\":true}\n",
      "BEGIN\n{\"ok\":true}\nCOMMIT\nextra\n",
      "BEGIN\n\n{\"ok\":true}\nCOMMIT\n",
      "BEGIN\n{\"ok\":true}\n{\"other\":true}\nCOMMIT\n",
      "BEGIN\n[]\nCOMMIT\n",
      "BEGIN\n{not-json}\nCOMMIT\n",
    ]) {
      expect(() => parseReadOnlyJsonOutput(invalid))
        .toThrow("Local GitHub repeatability preflight failed");
    }
  });

  it("requires the full expected 15-result official outcome set", () => {
    expect(assertExpectedOfficialResults({ count: 15, pass: 8, fail: 5, unknown: 2, notApplicable: 0, wrongInstallation: 0, unlinkedRun: 0, stale: 0, inactiveApproval: 0 }))
      .toEqual({ count: 15, pass: 8, fail: 5, unknown: 2, notApplicable: 0 });
    expect(() => assertExpectedOfficialResults({ count: 15, pass: 8, fail: 5, unknown: 2, notApplicable: 0, wrongInstallation: 0, unlinkedRun: 1, stale: 0, inactiveApproval: 0 }))
      .toThrow("Local GitHub repeatability preflight failed");
    expect(() => assertExpectedOfficialResults({ count: 15, pass: 8, fail: 5, unknown: 2, notApplicable: 0, wrongInstallation: 0, unlinkedRun: 0, stale: 1, inactiveApproval: 0 }))
      .toThrow("Local GitHub repeatability preflight failed");
  });

  it("requires the exact successful collection and reconciliation summaries", () => {
    const repository = { id: "44444444-4444-4444-8444-444444444444", organisation_id: organisationId, installation_id: installationId, provider_repository_id: 123 };
    const collection = {
      installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15,
      repositoriesFailed: 0, repositoriesDeferred: 0, runsPartial: 1,
      terminalRuns: [{ collectionRunId: "33333333-3333-4333-8333-333333333333", organisationId, installationId, repositoryId: repository.id, providerRepositoryId: 123, status: "partial" as const }],
    };
    expect(assertExpectedCollection(collection, repository)).toBe(collection);
    expect(() => assertExpectedCollection({ ...collection, runsPartial: 0 }, repository)).toThrow("Local GitHub repeatability preflight failed");
    expect(assertExpectedReconciliation({ runsConsidered: 1, materialised: 1, unchanged: 0, awaitingApproval: 0, needsAttention: 0 })).toBeUndefined();
    expect(() => assertExpectedReconciliation({ runsConsidered: 1, materialised: 0, unchanged: 0, awaitingApproval: 1, needsAttention: 0 })).toThrow("Local GitHub repeatability preflight failed");
  });

  it("contains no Slack, MCP, or cron import path", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const source = await readFile(join(process.cwd(), "scripts/local-github-repeatability.ts"), "utf8");
    expect(source).not.toMatch(/features\/(?:mcp|slack)|api\/cron|postDailyDigest/i);
  });

  it("passes Docker an exact label template without shell escape characters", () => {
    const args = localContainerInspectArgs();
    expect(args).toEqual([
      "inspect",
      "--format",
      "{{.State.Running}} {{index .Config.Labels \"com.supabase.cli.project\"}}",
      "supabase_db_compliancehub",
    ]);
    expect(args[2]).not.toContain("\\");
  });

  it("creates a redacted, order-independent lineage hash for terminal runs", () => {
    const run = {
      collectionRunId: "33333333-3333-4333-8333-333333333333",
      organisationId,
      installationId,
      repositoryId: "44444444-4444-4444-8444-444444444444",
      providerRepositoryId: 123,
      status: "partial" as const,
    };
    expect(terminalRunLineageHash([run])).toMatch(/^[0-9a-f]{64}$/);
    expect(terminalRunLineageHash([run, { ...run, collectionRunId: "55555555-5555-4555-8555-555555555555", repositoryId: "66666666-6666-4666-8666-666666666666", providerRepositoryId: 456 }]))
      .toBe(terminalRunLineageHash([{ ...run, collectionRunId: "55555555-5555-4555-8555-555555555555", repositoryId: "66666666-6666-4666-8666-666666666666", providerRepositoryId: 456 }, run]));
  });

  it("creates a redacted mapping-approval lineage hash without exposing its identifiers", () => {
    const approval = {
      id: "66666666-6666-4666-8666-666666666666",
      organisation_id: organisationId,
      mapping_pack_id: "77777777-7777-4777-8777-777777777777",
      github_mapping_packs: {
        id: "77777777-7777-4777-8777-777777777777",
        version: "github-compliance-v1",
        checksum: "a".repeat(64),
        published_at: "2026-08-29T00:00:00.000Z",
      },
    };

    const hash = mappingApprovalLineageHash(approval);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(approval.id);
    expect(mappingApprovalLineageHash({
      ...approval,
      github_mapping_packs: { ...approval.github_mapping_packs, version: "github-compliance-v2" },
    })).not.toBe(hash);
  });

  it("retains auditable protected-state digests and binds proof to both harness sources", () => {
    const digest = "b".repeat(64);
    expect(buildProtectedStateProof(digest, digest)).toEqual({
      beforeSha256: digest,
      afterSha256: digest,
      equal: true,
    });
    expect(() => buildProtectedStateProof(digest, "c".repeat(64)))
      .toThrow("Local GitHub repeatability preflight failed");

    const sourceHashes = harnessSourceHashes();
    expect(sourceHashes.scriptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceHashes.testSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceHashes.scriptSha256).not.toBe(sourceHashes.testSha256);
  });
});

describe.runIf(process.env.RUN_LOCAL_GITHUB_REPEATABILITY === "1")("local Mukta GitHub repeatability", () => {
  it("collects and reconciles only the configured User installation without changing protected SoA/risk/assessment state", async () => {
    const result = await runControlledRepeatability();
    expect(result.summary.protectedSoaRiskAssessmentUnchanged).toBe(true);
    expect(result.summary.collection.installationsChecked).toBe(1);
    // The proof has no credentials, URLs, repository names, or record content.
    console.log(JSON.stringify({ proofPath: result.proofPath, ...result.summary }));
  }, 120_000);
});
