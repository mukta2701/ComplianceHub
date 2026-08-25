import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { STANDARD_GITHUB_ISO_MAPPING_PACK } from "../domain/mapping";
import {
  buildMaterialisationDependencies,
  materialiseApprovedGitHubObservations,
  reconcileApprovedGitHubObservations,
  type MaterialisationDependencies,
} from "./materialise-approved-observations";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000001";
const APPROVAL_ID = "30000000-0000-4000-8000-000000000001";
const PACK_ID = "40000000-0000-4000-8000-000000000001";
const INSTALLATION_ID = "60000000-0000-4000-8000-000000000001";
const REPOSITORY_ID = "70000000-0000-4000-8000-000000000001";
const PROVIDER_REPOSITORY_ID = 71;
const OWNER = "mukta2701";
const REPOSITORY = "ComplianceHub";
const SUBJECT_ID = `${OWNER}/${REPOSITORY}`;
const SOURCE_URL = `https://github.com/${SUBJECT_ID}`;
const LEASE_TOKEN = randomUUID();
const SECOND_LEASE_TOKEN = randomUUID();

const ALL_CHECK_IDS = [
  "github.repository.visibility",
  "github.repository.archived",
  "github.branch.force_pushes",
  "github.branch.deletions",
  "github.branch.approving_reviews",
  "github.branch.stale_approvals",
  "github.branch.code_owner_reviews",
  "github.branch.status_checks",
  "github.dependabot.high_critical",
  "github.code_scanning.high_critical",
  "github.secret_scanning.enabled",
  "github.secret_scanning.push_protection",
  "github.secret_scanning.open_alerts",
  "github.workflow.security",
  "github.administration.outside_collaborator_admins",
] as const;

function observation(
  index: number,
  checkId: string,
  result: "pass" | "fail" | "unknown" | "not_applicable",
) {
  return {
    id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    organisation_id: ORGANISATION_ID,
    installation_id: INSTALLATION_ID,
    repository_id: REPOSITORY_ID,
    collection_run_id: RUN_ID,
    provider_repository_id: PROVIDER_REPOSITORY_ID,
    observation_key: `${SUBJECT_ID}/${checkId}/github-repository-v1`,
    check_id: checkId,
    rule_version: "github-repository-v1",
    subject_type: "github_repository",
    subject_id: SUBJECT_ID,
    result,
    severity: result === "fail" ? "high" : null,
    title: `Safe check ${index}`,
    explanation: `Safe bounded explanation ${index}`,
    remediation: result === "fail"
      ? "Block force pushes on the default branch."
      : result === "unknown"
        ? "Restore the required GitHub App permission or feature, then run collection again."
        : null,
    observed_at: "2026-08-24T10:00:00.000Z",
    fresh_until: "2026-08-25T10:00:00.000Z",
    source_url: SOURCE_URL,
    fingerprint: String(index).padStart(64, "a").slice(-64),
    diagnostic_code: result === "unknown" ? "permission_denied" : null,
  };
}

function completeObservations() {
  return ALL_CHECK_IDS.map((checkId, index) => observation(
    index + 1,
    checkId,
    checkId === "github.branch.force_pushes"
      ? "fail"
      : checkId === "github.branch.status_checks"
        ? "unknown"
        : checkId === "github.repository.archived"
          ? "not_applicable"
          : "pass",
  ));
}

function terminalRun(status: "succeeded" | "partial" = "partial") {
  return {
    runId: RUN_ID,
    organisationId: ORGANISATION_ID,
    installationId: INSTALLATION_ID,
    repositoryId: REPOSITORY_ID,
    providerRepositoryId: PROVIDER_REPOSITORY_ID,
    status,
    observationCount: 15,
    repositoryOwner: OWNER,
    repositoryName: REPOSITORY,
    repositorySourceUrl: SOURCE_URL,
  };
}

function dependencies(overrides: Partial<MaterialisationDependencies> = {}) {
  const value: MaterialisationDependencies = {
    claimJobs: vi.fn().mockResolvedValue([{
      jobId: "80000000-0000-4000-8000-000000000001",
      leaseToken: LEASE_TOKEN,
      attemptCount: 1,
      collectionRunId: RUN_ID,
      organisationId: ORGANISATION_ID,
    }]),
    finaliseJob: vi.fn().mockResolvedValue(true),
    inspectJobs: vi.fn().mockResolvedValue([]),
    loadTerminalRun: vi.fn().mockResolvedValue(terminalRun()),
    loadActiveApproval: vi.fn().mockResolvedValue({
      approvalId: APPROVAL_ID,
      mappingPackId: PACK_ID,
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      publishedAt: "2026-08-24T09:00:00.000Z",
    }),
    loadObservations: vi.fn().mockResolvedValue(completeObservations()),
    materialise: vi.fn().mockResolvedValue({
      data: {
        evidence_created: 1,
        evidence_refreshed: 0,
        findings_created: 1,
        findings_refreshed: 0,
        findings_reopened: 0,
        findings_resolved: 0,
        skipped: 13,
      },
      error: null,
    }),
    ...overrides,
  };
  return value as MaterialisationDependencies & {
    claimJobs: ReturnType<typeof vi.fn>;
    finaliseJob: ReturnType<typeof vi.fn>;
    inspectJobs: ReturnType<typeof vi.fn>;
    loadTerminalRun: ReturnType<typeof vi.fn>;
    loadActiveApproval: ReturnType<typeof vi.fn>;
    loadObservations: ReturnType<typeof vi.fn>;
    materialise: ReturnType<typeof vi.fn>;
  };
}

describe("materialiseApprovedGitHubObservations", () => {
  it("returns awaiting_approval without loading observations or invoking the RPC", async () => {
    const deps = dependencies({ loadActiveApproval: vi.fn().mockResolvedValue(null) });

    await expect(materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    })).resolves.toEqual({ status: "awaiting_approval", collectionRunId: RUN_ID });

    expect(deps.loadObservations).not.toHaveBeenCalled();
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it("does not load approval or observations when the target is failed, running, or absent", async () => {
    const deps = dependencies({ loadTerminalRun: vi.fn().mockResolvedValue(null) });

    await expect(materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    })).resolves.toEqual({ status: "not_terminal", collectionRunId: RUN_ID });

    expect(deps.loadActiveApproval).not.toHaveBeenCalled();
    expect(deps.loadObservations).not.toHaveBeenCalled();
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it("rejects an active approval for a stale or unsealed pack before observations are loaded", async () => {
    const deps = dependencies({
      loadActiveApproval: vi.fn().mockResolvedValue({
        approvalId: APPROVAL_ID,
        mappingPackId: PACK_ID,
        version: "github-iso-27001-v0",
        checksum: "b".repeat(64),
        publishedAt: null,
      }),
    });

    await expect(materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    })).resolves.toEqual({ status: "stale_approval", collectionRunId: RUN_ID });

    expect(deps.loadObservations).not.toHaveBeenCalled();
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it("validates and deterministically maps observations into exact five-key RPC decisions", async () => {
    const deps = dependencies();

    const result = await materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    });

    expect(result).toEqual({
      status: "materialised",
      collectionRunId: RUN_ID,
      runStatus: "partial",
      evidenceCreated: 1,
      evidenceRefreshed: 0,
      findingsCreated: 1,
      findingsRefreshed: 0,
      findingsReopened: 0,
      findingsResolved: 0,
      skipped: 13,
    });
    const rpcInput = deps.materialise.mock.calls[0]![0];
    expect(rpcInput).toMatchObject({
      target_organisation_id: ORGANISATION_ID,
      target_collection_run_id: RUN_ID,
      target_mapping_version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      target_mapping_checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
    });
    expect(rpcInput.target_decisions.map((decision: Record<string, unknown>) => decision.observation_id)).toEqual([
      "50000000-0000-4000-8000-000000000015",
      "50000000-0000-4000-8000-000000000005",
      "50000000-0000-4000-8000-000000000007",
      "50000000-0000-4000-8000-000000000004",
      "50000000-0000-4000-8000-000000000003",
      "50000000-0000-4000-8000-000000000006",
      "50000000-0000-4000-8000-000000000008",
      "50000000-0000-4000-8000-000000000010",
      "50000000-0000-4000-8000-000000000009",
      "50000000-0000-4000-8000-000000000002",
      "50000000-0000-4000-8000-000000000001",
      "50000000-0000-4000-8000-000000000011",
      "50000000-0000-4000-8000-000000000013",
      "50000000-0000-4000-8000-000000000012",
      "50000000-0000-4000-8000-000000000014",
    ]);
    expect(rpcInput.target_decisions.find((decision: Record<string, unknown>) => decision.observation_id === "50000000-0000-4000-8000-000000000003")).toEqual({
      observation_id: "50000000-0000-4000-8000-000000000003",
      treatment_kind: "finding",
      iso_control_references: ["A.8.25", "A.8.32"],
      failure_severity: "high",
      remediation: "Block force pushes on the default branch.",
    });
    expect(rpcInput.target_decisions.every((decision: Record<string, unknown>) => Object.keys(decision).length === 5)).toBe(true);
    expect(JSON.stringify(rpcInput)).not.toContain("Safe bounded explanation");
    expect(JSON.stringify(result)).not.toContain("Safe bounded explanation");
  });

  it.each([
    ["a non-15 run count", completeObservations(), { ...terminalRun("succeeded"), observationCount: 14 }],
    ["a missing expected check", completeObservations().slice(0, -1), terminalRun("succeeded")],
    ["a duplicate expected check", [...completeObservations().slice(0, -1), completeObservations()[0]], terminalRun("succeeded")],
    ["an unknown check", completeObservations().map((row, index) => index === 0 ? {
      ...row,
      check_id: "github.unreviewed.check",
      observation_key: `${SUBJECT_ID}/github.unreviewed.check/github-repository-v1`,
    } : row), terminalRun("succeeded")],
  ])("returns invalid_data for %s without invoking the RPC", async (_label, rows, run) => {
    const deps = dependencies({
      loadTerminalRun: vi.fn().mockResolvedValue(run),
      loadObservations: vi.fn().mockResolvedValue(rows),
    });

    await expect(materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    })).resolves.toEqual({ status: "invalid_data", collectionRunId: RUN_ID });
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it.each([
    ["organisation_id", "10000000-0000-4000-8000-000000000099"],
    ["installation_id", "60000000-0000-4000-8000-000000000099"],
    ["repository_id", "70000000-0000-4000-8000-000000000099"],
    ["provider_repository_id", 99],
    ["collection_run_id", "20000000-0000-4000-8000-000000000099"],
  ])("rejects cross-ancestry %s before the RPC", async (field, value) => {
    const rows = completeObservations();
    rows[0] = { ...rows[0], [field]: value };
    const deps = dependencies({ loadObservations: vi.fn().mockResolvedValue(rows) });

    await expect(materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    })).resolves.toEqual({ status: "invalid_data", collectionRunId: RUN_ID });
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it.each([
    ["observation_key", "wrong/key"],
    ["subject_id", "another/repository"],
    ["source_url", "https://github.com/another/repository"],
    ["rule_version", "github-repository-v0"],
  ])("rejects a non-canonical %s relationship before the RPC", async (field, value) => {
    const rows = completeObservations();
    rows[0] = { ...rows[0], [field]: value };
    const deps = dependencies({ loadObservations: vi.fn().mockResolvedValue(rows) });

    await expect(materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    })).resolves.toEqual({ status: "invalid_data", collectionRunId: RUN_ID });
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it("rejects non-canonical repository metadata before observations are trusted", async () => {
    const deps = dependencies({
      loadTerminalRun: vi.fn().mockResolvedValue({
        ...terminalRun(),
        repositorySourceUrl: "https://github.com/another/repository",
      }),
    });

    await expect(materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    })).resolves.toEqual({ status: "invalid_data", collectionRunId: RUN_ID });
    expect(deps.loadObservations).not.toHaveBeenCalled();
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it.each([
    ["pass severity", 0, { severity: "high" }],
    ["pass remediation", 0, { remediation: "Do something." }],
    ["pass diagnostic", 0, { diagnostic_code: "permission_denied" }],
    ["fail severity", 2, { severity: null }],
    ["fail mapped severity", 2, { severity: "low" }],
    ["fail remediation", 2, { remediation: null }],
    ["fail mapped remediation", 2, { remediation: "Wrong remediation." }],
    ["fail diagnostic", 2, { diagnostic_code: "permission_denied" }],
    ["unknown severity", 7, { severity: "high" }],
    ["unknown remediation", 7, { remediation: null }],
    ["unknown canonical remediation", 7, { remediation: "Try again later." }],
    ["unknown diagnostic", 7, { diagnostic_code: null }],
    ["not-applicable severity", 1, { severity: "low" }],
    ["not-applicable remediation", 1, { remediation: "Do something." }],
    ["not-applicable diagnostic", 1, { diagnostic_code: "permission_denied" }],
  ])("rejects invalid %s semantics before the RPC", async (_label, index, mutation) => {
    const rows = completeObservations();
    rows[index] = { ...rows[index], ...mutation } as typeof rows[number];
    const deps = dependencies({ loadObservations: vi.fn().mockResolvedValue(rows) });

    await expect(materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    })).resolves.toEqual({ status: "invalid_data", collectionRunId: RUN_ID });
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it("returns unchanged for an idempotent repeat or losing concurrent caller", async () => {
    const deps = dependencies({
      materialise: vi.fn().mockResolvedValue({
        data: {
          evidence_created: 0,
          evidence_refreshed: 0,
          findings_created: 0,
          findings_refreshed: 0,
          findings_reopened: 0,
          findings_resolved: 0,
          skipped: 15,
        },
        error: null,
      }),
    });

    const result = await materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    });

    expect(result.status).toBe("unchanged");
    expect(deps.materialise).toHaveBeenCalledOnce();
  });

  it("safely delegates simultaneous callers to the atomic Task 2 RPC", async () => {
    const deps = dependencies({
      materialise: vi.fn().mockResolvedValue({
        data: {
          evidence_created: 0, evidence_refreshed: 0, findings_created: 0,
          findings_refreshed: 0, findings_reopened: 0, findings_resolved: 0, skipped: 15,
        },
        error: null,
      }),
    });

    const outcomes = await Promise.all([
      materialiseApprovedGitHubObservations(deps, { organisationId: ORGANISATION_ID, collectionRunId: RUN_ID }),
      materialiseApprovedGitHubObservations(deps, { organisationId: ORGANISATION_ID, collectionRunId: RUN_ID }),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["unchanged", "unchanged"]);
    expect(deps.materialise).toHaveBeenCalledTimes(2);
    expect(deps.materialise.mock.calls[0]?.[0]).toEqual(deps.materialise.mock.calls[1]?.[0]);
  });

  it.each([
    ["permission_denied", { code: "42501", message: "private approval detail" }],
    ["retryable_failure", { code: "40001", message: "private serialization detail" }],
    ["retryable_failure", { message: "private provider body" }],
  ] as const)("returns the safe %s outcome without rewriting the terminal run", async (status, error) => {
    const deps = dependencies({ materialise: vi.fn().mockResolvedValue({ data: null, error }) });

    const result = await materialiseApprovedGitHubObservations(deps, {
      organisationId: ORGANISATION_ID,
      collectionRunId: RUN_ID,
    });

    expect(result).toEqual({ status, collectionRunId: RUN_ID });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(deps.loadTerminalRun).toHaveBeenCalledOnce();
  });
});

describe("reconcileApprovedGitHubObservations", () => {
  it("claims durable jobs and safely finalises successful and retryable outcomes", async () => {
    const deps = dependencies({
      claimJobs: vi.fn().mockResolvedValue([
        { jobId: "80000000-0000-4000-8000-000000000001", leaseToken: LEASE_TOKEN, attemptCount: 1, collectionRunId: RUN_ID, organisationId: ORGANISATION_ID },
        { jobId: "80000000-0000-4000-8000-000000000002", leaseToken: SECOND_LEASE_TOKEN, attemptCount: 2, collectionRunId: "20000000-0000-4000-8000-000000000002", organisationId: ORGANISATION_ID },
      ]),
    });
    deps.loadTerminalRun
      .mockResolvedValueOnce(terminalRun())
      .mockRejectedValueOnce(new Error("private loading detail"));

    const result = await reconcileApprovedGitHubObservations(deps, { limit: 20 });

    expect(deps.claimJobs).toHaveBeenCalledWith({ limit: 20 });
    expect(deps.finaliseJob).toHaveBeenNthCalledWith(1, {
      jobId: "80000000-0000-4000-8000-000000000001",
      leaseToken: LEASE_TOKEN,
      attemptCount: 1,
      outcome: "completed",
    });
    expect(deps.finaliseJob).toHaveBeenNthCalledWith(2, {
      jobId: "80000000-0000-4000-8000-000000000002",
      leaseToken: SECOND_LEASE_TOKEN,
      attemptCount: 2,
      outcome: "retryable",
    });
    expect(result).toEqual({
      runsConsidered: 2,
      materialised: 1,
      unchanged: 0,
      awaitingApproval: 0,
      needsAttention: 1,
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("claims exact collector-returned runs without newest-run sampling", async () => {
    const deps = dependencies();
    const terminalRuns = [{
      collectionRunId: RUN_ID,
      organisationId: ORGANISATION_ID,
      installationId: INSTALLATION_ID,
      repositoryId: REPOSITORY_ID,
      providerRepositoryId: PROVIDER_REPOSITORY_ID,
      status: "partial" as const,
    }];

    await reconcileApprovedGitHubObservations(deps, { limit: 100, terminalRuns });

    expect(deps.claimJobs).toHaveBeenCalledWith({ limit: 1, collectionRunIds: [RUN_ID] });
  });

  it("surfaces an exact exhausted job as attention instead of false healthy", async () => {
    const deps = dependencies({
      claimJobs: vi.fn().mockResolvedValue([]),
      inspectJobs: vi.fn().mockResolvedValue([{
        collectionRunId: RUN_ID,
        status: "exhausted",
        leaseActive: false,
      }]),
    });

    const result = await reconcileApprovedGitHubObservations(deps, {
      limit: 100,
      terminalRuns: [{
        collectionRunId: RUN_ID,
        organisationId: ORGANISATION_ID,
        installationId: INSTALLATION_ID,
        repositoryId: REPOSITORY_ID,
        providerRepositoryId: PROVIDER_REPOSITORY_ID,
        status: "partial",
      }],
    });

    expect(deps.inspectJobs).toHaveBeenCalledWith({ limit: 1, collectionRunIds: [RUN_ID] });
    expect(result).toEqual({
      runsConsidered: 1, materialised: 0, unchanged: 0, awaitingApproval: 0, needsAttention: 1,
    });
  });

  it("surfaces an exact active lease as attention instead of false healthy", async () => {
    const deps = dependencies({
      claimJobs: vi.fn().mockResolvedValue([]),
      inspectJobs: vi.fn().mockResolvedValue([{
        collectionRunId: RUN_ID,
        status: "pending",
        leaseActive: true,
      }]),
    });

    const result = await reconcileApprovedGitHubObservations(deps, {
      limit: 100,
      terminalRuns: [{
        collectionRunId: RUN_ID,
        organisationId: ORGANISATION_ID,
        installationId: INSTALLATION_ID,
        repositoryId: REPOSITORY_ID,
        providerRepositoryId: PROVIDER_REPOSITORY_ID,
        status: "succeeded",
      }],
    });

    expect(result.needsAttention).toBe(1);
    expect(result.runsConsidered).toBe(1);
  });

  it("recognises an exact completed job without reclaiming or reporting attention", async () => {
    const deps = dependencies({
      claimJobs: vi.fn().mockResolvedValue([]),
      inspectJobs: vi.fn().mockResolvedValue([{
        collectionRunId: RUN_ID,
        status: "completed",
        leaseActive: false,
      }]),
    });

    const result = await reconcileApprovedGitHubObservations(deps, {
      limit: 100,
      terminalRuns: [{
        collectionRunId: RUN_ID,
        organisationId: ORGANISATION_ID,
        installationId: INSTALLATION_ID,
        repositoryId: REPOSITORY_ID,
        providerRepositoryId: PROVIDER_REPOSITORY_ID,
        status: "succeeded",
      }],
    });

    expect(result).toEqual({
      runsConsidered: 1, materialised: 0, unchanged: 0, awaitingApproval: 0, needsAttention: 0,
    });
  });

  it("surfaces exhausted jobs during a bounded generic recovery sweep", async () => {
    const deps = dependencies({
      claimJobs: vi.fn().mockResolvedValue([]),
      inspectJobs: vi.fn().mockResolvedValue([{
        collectionRunId: RUN_ID,
        status: "exhausted",
        leaseActive: false,
      }]),
    });

    const result = await reconcileApprovedGitHubObservations(deps, { limit: 20 });

    expect(deps.inspectJobs).toHaveBeenCalledWith({ limit: 20 });
    expect(result.needsAttention).toBe(1);
    expect(result.runsConsidered).toBe(1);
  });

  it("parks a claimed job as awaiting approval without treating it as unhealthy", async () => {
    const deps = dependencies({ loadActiveApproval: vi.fn().mockResolvedValue(null) });

    const result = await reconcileApprovedGitHubObservations(deps, { limit: 20 });

    expect(result).toEqual({
      runsConsidered: 1, materialised: 0, unchanged: 0, awaitingApproval: 1, needsAttention: 0,
    });
    expect(deps.finaliseJob).toHaveBeenCalledWith(expect.objectContaining({ outcome: "awaiting_approval" }));
    expect(deps.materialise).not.toHaveBeenCalled();
  });

  it("inspects every exact collector-returned run beyond one hundred without false healthy", async () => {
    const inspectJobs = vi.fn().mockImplementation(async ({ collectionRunIds }: { collectionRunIds: string[] }) => (
      collectionRunIds.map((collectionRunId) => ({
        collectionRunId,
        status: "exhausted",
        leaseActive: false,
      }))
    ));
    const deps = dependencies({ claimJobs: vi.fn().mockResolvedValue([]), inspectJobs });
    const terminalRuns = Array.from({ length: 201 }, (_, index) => ({
      collectionRunId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      organisationId: ORGANISATION_ID,
      installationId: INSTALLATION_ID,
      repositoryId: REPOSITORY_ID,
      providerRepositoryId: PROVIDER_REPOSITORY_ID,
      status: "succeeded" as const,
    }));

    const result = await reconcileApprovedGitHubObservations(deps, { limit: 100, terminalRuns });

    expect(deps.claimJobs).toHaveBeenCalledTimes(3);
    expect(deps.claimJobs.mock.calls.map(([scope]) => scope.limit)).toEqual([100, 100, 1]);
    expect(deps.claimJobs.mock.calls.flatMap(([scope]) => scope.collectionRunIds)).toHaveLength(201);
    expect(inspectJobs).toHaveBeenCalledTimes(3);
    expect(inspectJobs.mock.calls.flatMap(([scope]) => scope.collectionRunIds)).toHaveLength(201);
    expect(result.runsConsidered).toBe(201);
    expect(result.needsAttention).toBe(201);
  });
});

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<{ data: unknown; error: unknown }> = {
    then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  } as never;
  for (const method of ["select", "eq", "in", "is", "not", "gte", "order", "limit", "maybeSingle"]) {
    builder[method] = vi.fn(() => builder);
  }
  return builder;
}

describe("buildMaterialisationDependencies", () => {
  it("claims bounded durable jobs and finalises only the matching lease", async () => {
    const service = { from: vi.fn(), rpc: vi.fn()
      .mockResolvedValueOnce({ data: [{
        job_id: "80000000-0000-4000-8000-000000000001",
        lease_token: LEASE_TOKEN,
        attempt_count: 1,
        collection_run_id: RUN_ID,
        organisation_id: ORGANISATION_ID,
      }], error: null })
      .mockResolvedValueOnce({ data: true, error: null }) };
    const deps = buildMaterialisationDependencies(service);

    await expect(deps.claimJobs({ limit: 7, collectionRunIds: [RUN_ID] })).resolves.toHaveLength(1);
    await expect(deps.finaliseJob({
      jobId: "80000000-0000-4000-8000-000000000001",
      leaseToken: LEASE_TOKEN,
      attemptCount: 1,
      outcome: "completed",
    })).resolves.toBe(true);

    expect(service.rpc).toHaveBeenNthCalledWith(1, "claim_github_materialisation_jobs_server", {
      target_limit: 7,
      target_collection_run_ids: [RUN_ID],
    });
    expect(service.rpc).toHaveBeenNthCalledWith(2, "finalize_github_materialisation_job_server", {
      target_job_id: "80000000-0000-4000-8000-000000000001",
      target_lease_token: LEASE_TOKEN,
      target_attempt_count: 1,
      target_outcome: "completed",
    });
  });

  it("preserves a zero real-attempt counter for an awaiting-approval lease", async () => {
    const service = { from: vi.fn(), rpc: vi.fn()
      .mockResolvedValueOnce({ data: [{
        job_id: "80000000-0000-4000-8000-000000000001",
        lease_token: LEASE_TOKEN,
        attempt_count: 0,
        collection_run_id: RUN_ID,
        organisation_id: ORGANISATION_ID,
      }], error: null })
      .mockResolvedValueOnce({ data: true, error: null }) };
    const deps = buildMaterialisationDependencies(service);

    await expect(deps.claimJobs({ limit: 1, collectionRunIds: [RUN_ID] })).resolves.toEqual([
      expect.objectContaining({ attemptCount: 0 }),
    ]);
    await expect(deps.finaliseJob({
      jobId: "80000000-0000-4000-8000-000000000001",
      leaseToken: LEASE_TOKEN,
      attemptCount: 0,
      outcome: "awaiting_approval",
    })).resolves.toBe(true);
    expect(service.rpc).toHaveBeenNthCalledWith(2, "finalize_github_materialisation_job_server", {
      target_job_id: "80000000-0000-4000-8000-000000000001",
      target_lease_token: LEASE_TOKEN,
      target_attempt_count: 0,
      target_outcome: "awaiting_approval",
    });
  });

  it("inspects bounded exact job states through a service-only RPC", async () => {
    const service = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({
      data: [{ collection_run_id: RUN_ID, status: "exhausted", lease_active: false }],
      error: null,
    }) };
    const deps = buildMaterialisationDependencies(service);

    await expect(deps.inspectJobs({ limit: 1, collectionRunIds: [RUN_ID] })).resolves.toEqual([{
      collectionRunId: RUN_ID,
      status: "exhausted",
      leaseActive: false,
    }]);
    expect(service.rpc).toHaveBeenCalledWith("inspect_github_materialisation_jobs_server", {
      target_limit: 1,
      target_collection_run_ids: [RUN_ID],
    });
  });

  it("loads a terminal run, its active sealed approval, and only bounded observation fields", async () => {
    const run = query({
      data: {
        id: RUN_ID,
        organisation_id: ORGANISATION_ID,
        installation_id: INSTALLATION_ID,
        repository_id: REPOSITORY_ID,
        status: "succeeded",
        observation_count: 15,
        github_repositories: {
          provider_repository_id: PROVIDER_REPOSITORY_ID,
          owner_login: OWNER,
          name: REPOSITORY,
          html_url: SOURCE_URL,
        },
      },
      error: null,
    });
    const approval = query({
      data: {
        id: APPROVAL_ID,
        mapping_pack_id: PACK_ID,
        github_mapping_packs: {
          id: PACK_ID,
          version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
          checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
          published_at: "2026-08-24T09:00:00.000Z",
        },
      },
      error: null,
    });
    const observations = query({ data: [observation(1, "github.repository.visibility", "pass")], error: null });
    const service = {
      from: vi.fn((table: string) => {
        if (table === "github_mapping_approvals") return approval;
        if (table === "github_observations") return observations;
        return run;
      }),
      rpc: vi.fn().mockResolvedValue({ data: { skipped: 1 }, error: null }),
    };
    const deps = buildMaterialisationDependencies(service);

    await expect(deps.loadTerminalRun({ organisationId: ORGANISATION_ID, collectionRunId: RUN_ID })).resolves.toEqual({
      runId: RUN_ID,
      organisationId: ORGANISATION_ID,
      status: "succeeded",
      observationCount: 15,
      installationId: INSTALLATION_ID,
      repositoryId: REPOSITORY_ID,
      providerRepositoryId: PROVIDER_REPOSITORY_ID,
      repositoryOwner: OWNER,
      repositoryName: REPOSITORY,
      repositorySourceUrl: SOURCE_URL,
    });
    await expect(deps.loadActiveApproval(ORGANISATION_ID)).resolves.toEqual({
      approvalId: APPROVAL_ID,
      mappingPackId: PACK_ID,
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      publishedAt: "2026-08-24T09:00:00.000Z",
    });
    await expect(deps.loadObservations({ organisationId: ORGANISATION_ID, collectionRunId: RUN_ID })).resolves.toHaveLength(1);

    expect(run.select).toHaveBeenCalledWith(
      "id,organisation_id,installation_id,repository_id,status,observation_count,github_repositories!github_collection_runs_provider_repository_tenant_fk(provider_repository_id,owner_login,name,html_url)",
    );
    expect(run.in).toHaveBeenCalledWith("status", ["succeeded", "partial"]);
    expect(approval.is).toHaveBeenCalledWith("revoked_at", null);
    expect(approval.not).toHaveBeenCalledWith("github_mapping_packs.published_at", "is", null);
    expect(observations.select).toHaveBeenCalledWith(
      "id,organisation_id,installation_id,repository_id,collection_run_id,provider_repository_id,observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code",
    );
    expect(observations.order).toHaveBeenNthCalledWith(1, "check_id", { ascending: true });
    expect(observations.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(observations.limit).toHaveBeenCalledWith(100);
  });
});
