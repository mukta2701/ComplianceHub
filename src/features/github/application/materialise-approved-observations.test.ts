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

function observation(
  index: number,
  checkId: string,
  result: "pass" | "fail" | "unknown" | "not_applicable",
) {
  return {
    id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    collection_run_id: RUN_ID,
    provider_repository_id: 71,
    observation_key: `mukta2701/ComplianceHub/${checkId}/github-repository-v1`,
    check_id: checkId,
    rule_version: "github-repository-v1",
    subject_type: "github_repository",
    subject_id: "mukta2701/ComplianceHub",
    result,
    severity: result === "fail" ? "high" : null,
    title: `Safe check ${index}`,
    explanation: `Safe bounded explanation ${index}`,
    remediation: result === "fail" ? "Safe provider remediation." : null,
    observed_at: "2026-08-24T10:00:00.000Z",
    fresh_until: "2026-08-25T10:00:00.000Z",
    source_url: "https://github.com/mukta2701/ComplianceHub",
    fingerprint: String(index).padStart(64, "a").slice(-64),
    diagnostic_code: result === "unknown" ? "permission_denied" : null,
  };
}

function dependencies(overrides: Partial<MaterialisationDependencies> = {}) {
  const value: MaterialisationDependencies = {
    listTerminalRuns: vi.fn().mockResolvedValue([{ runId: RUN_ID, organisationId: ORGANISATION_ID }]),
    loadTerminalRun: vi.fn().mockResolvedValue({
      runId: RUN_ID,
      organisationId: ORGANISATION_ID,
      status: "partial",
      observationCount: 4,
    }),
    loadActiveApproval: vi.fn().mockResolvedValue({
      approvalId: APPROVAL_ID,
      mappingPackId: PACK_ID,
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      publishedAt: "2026-08-24T09:00:00.000Z",
    }),
    loadObservations: vi.fn().mockResolvedValue([
      observation(4, "github.repository.archived", "not_applicable"),
      observation(2, "github.branch.force_pushes", "fail"),
      observation(3, "github.branch.status_checks", "unknown"),
      observation(1, "github.repository.visibility", "pass"),
    ]),
    materialise: vi.fn().mockResolvedValue({
      data: {
        evidence_created: 1,
        evidence_refreshed: 0,
        findings_created: 1,
        findings_refreshed: 0,
        findings_reopened: 0,
        findings_resolved: 0,
        skipped: 2,
      },
      error: null,
    }),
    ...overrides,
  };
  return value as MaterialisationDependencies & {
    listTerminalRuns: ReturnType<typeof vi.fn>;
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
      skipped: 2,
    });
    const rpcInput = deps.materialise.mock.calls[0]![0];
    expect(rpcInput).toMatchObject({
      target_organisation_id: ORGANISATION_ID,
      target_collection_run_id: RUN_ID,
      target_mapping_version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      target_mapping_checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
    });
    expect(rpcInput.target_decisions.map((decision: Record<string, unknown>) => decision.observation_id)).toEqual([
      "50000000-0000-4000-8000-000000000002",
      "50000000-0000-4000-8000-000000000003",
      "50000000-0000-4000-8000-000000000004",
      "50000000-0000-4000-8000-000000000001",
    ]);
    expect(rpcInput.target_decisions[0]).toEqual({
      observation_id: "50000000-0000-4000-8000-000000000002",
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
    ["malformed observation", [observation(1, "github.repository.visibility", "pass")], 4],
    ["unknown check", [observation(1, "github.unreviewed.check", "pass")], 1],
    ["duplicated observation", [
      observation(1, "github.repository.visibility", "pass"),
      observation(1, "github.repository.visibility", "pass"),
    ], 2],
  ])("returns invalid_data for %s without invoking the RPC", async (_label, rows, count) => {
    const deps = dependencies({
      loadTerminalRun: vi.fn().mockResolvedValue({
        runId: RUN_ID,
        organisationId: ORGANISATION_ID,
        status: "succeeded",
        observationCount: count,
      }),
      loadObservations: vi.fn().mockResolvedValue(rows),
    });

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
          skipped: 4,
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
  it("runs a bounded deterministic recovery sweep and reports attention without throwing", async () => {
    const deps = dependencies({
      listTerminalRuns: vi.fn().mockResolvedValue([
        { runId: RUN_ID, organisationId: ORGANISATION_ID },
        { runId: "20000000-0000-4000-8000-000000000002", organisationId: ORGANISATION_ID },
      ]),
    });
    deps.loadTerminalRun
      .mockResolvedValueOnce({ runId: RUN_ID, organisationId: ORGANISATION_ID, status: "partial", observationCount: 4 })
      .mockRejectedValueOnce(new Error("private loading detail"));

    const result = await reconcileApprovedGitHubObservations(deps, { limit: 20 });

    expect(deps.listTerminalRuns).toHaveBeenCalledWith({ limit: 20 });
    expect(result).toEqual({
      runsConsidered: 2,
      materialised: 1,
      unchanged: 0,
      awaitingApproval: 0,
      needsAttention: 1,
    });
    expect(JSON.stringify(result)).not.toContain("private");
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
  it("loads only bounded terminal runs in deterministic completion order", async () => {
    const runs = query({
      data: [{ id: RUN_ID, organisation_id: ORGANISATION_ID }],
      error: null,
    });
    const service = { from: vi.fn(() => runs), rpc: vi.fn() };
    const deps = buildMaterialisationDependencies(service);

    const result = await deps.listTerminalRuns({
      limit: 7,
      organisationId: ORGANISATION_ID,
      installationId: "60000000-0000-4000-8000-000000000001",
      repositoryId: "70000000-0000-4000-8000-000000000001",
      completedAfter: "2026-08-24T09:59:00.000Z",
    });

    expect(service.from).toHaveBeenCalledWith("github_collection_runs");
    expect(runs.select).toHaveBeenCalledWith("id,organisation_id");
    expect(runs.in).toHaveBeenCalledWith("status", ["succeeded", "partial"]);
    expect(runs.not).toHaveBeenCalledWith("completed_at", "is", null);
    expect(runs.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(runs.eq).toHaveBeenCalledWith("installation_id", "60000000-0000-4000-8000-000000000001");
    expect(runs.eq).toHaveBeenCalledWith("repository_id", "70000000-0000-4000-8000-000000000001");
    expect(runs.gte).toHaveBeenCalledWith("completed_at", "2026-08-24T09:59:00.000Z");
    expect(runs.order).toHaveBeenNthCalledWith(1, "completed_at", { ascending: false });
    expect(runs.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(runs.limit).toHaveBeenCalledWith(7);
    expect(result).toEqual([{ runId: RUN_ID, organisationId: ORGANISATION_ID }]);
  });

  it("loads a terminal run, its active sealed approval, and only bounded observation fields", async () => {
    const run = query({
      data: { id: RUN_ID, organisation_id: ORGANISATION_ID, status: "succeeded", observation_count: 1 },
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
      observationCount: 1,
    });
    await expect(deps.loadActiveApproval(ORGANISATION_ID)).resolves.toEqual({
      approvalId: APPROVAL_ID,
      mappingPackId: PACK_ID,
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      publishedAt: "2026-08-24T09:00:00.000Z",
    });
    await expect(deps.loadObservations({ organisationId: ORGANISATION_ID, collectionRunId: RUN_ID })).resolves.toHaveLength(1);

    expect(run.in).toHaveBeenCalledWith("status", ["succeeded", "partial"]);
    expect(approval.is).toHaveBeenCalledWith("revoked_at", null);
    expect(approval.not).toHaveBeenCalledWith("github_mapping_packs.published_at", "is", null);
    expect(observations.select).toHaveBeenCalledWith(
      "id,collection_run_id,provider_repository_id,observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code",
    );
    expect(observations.order).toHaveBeenNthCalledWith(1, "check_id", { ascending: true });
    expect(observations.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(observations.limit).toHaveBeenCalledWith(100);
  });
});
