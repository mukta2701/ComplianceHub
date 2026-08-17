import { describe, expect, it, vi } from "vitest";

import { buildCollectionDependencies } from "./collection-deps";

function queryResult(data: unknown, error: unknown = null) {
  const promise = Promise.resolve({ data, error });
  return Object.assign(promise, {
    select: vi.fn(() => queryResult(data, error)),
    eq: vi.fn(() => queryResult(data, error)),
    order: vi.fn(() => queryResult(data, error)),
  });
}

describe("buildCollectionDependencies", () => {
  it("loads only verified selected targets and rejects mismatched ancestry", async () => {
    const from = vi.fn((table: string) => {
      if (table === "github_repositories") return queryResult([{ id: "repo", organisation_id: "org", installation_id: "inst", provider_repository_id: 101, owner_login: "adtecher", name: "portal", selected: true, available: true, github_installations: { id: "inst", organisation_id: "other", provider_installation_id: 77, status: "active", permissions_ok: true } }]);
      throw new Error("unexpected table");
    });
    const deps = buildCollectionDependencies({ from, rpc: vi.fn() } as never, { appId: "1", privateKey: "key", approvedSecurityWorkflowIds: [1] });

    await expect(deps.listTargets({ trigger: "scheduled", requestKey: "scheduled:2026-08-17" })).rejects.toThrow("GitHub collection target loading failed");
  });

  it("passes the full ancestry and current lease CAS to persistence RPCs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const deps = buildCollectionDependencies({ from: vi.fn(), rpc } as never, { appId: "1", privateKey: "key", approvedSecurityWorkflowIds: [1] });
    const target = { organisationId: "org", installationId: "inst", repositoryId: "repo", providerInstallationId: 77, providerRepositoryId: 101, owner: "adtecher", name: "portal" };
    const lease = { runId: "run", leaseToken: "lease", leaseExpiresAt: "2026-08-17T05:31:00.000Z", attempt: 2, acquisitionState: "reclaimed" as const, status: "running" as const, organisationId: "org", installationId: "inst", repositoryId: "repo", providerRepositoryId: 101 };

    await deps.finaliseRun(lease, target, { status: "failed", diagnosticCode: "invalid_response", observationCount: 0, passedCount: 0, failedCount: 0, unknownCount: 0, notApplicableCount: 0 });

    expect(rpc).toHaveBeenCalledWith("finalise_github_collection_run_server", expect.objectContaining({ target_run_id: "run", target_organisation_id: "org", target_installation_id: "inst", target_repository_id: "repo", target_provider_repository_id: 101, target_lease_token: "lease", target_attempt: 2 }));
  });

  it("fails closed when a scoped local target does not resolve", async () => {
    const from = vi.fn(() => queryResult([]));
    const deps = buildCollectionDependencies({ from, rpc: vi.fn() }, { appId: "1", privateKey: "key", approvedSecurityWorkflowIds: [1] });
    await expect(deps.listTargets({ trigger: "manual", requestKey: "manual:missing", repositoryId: "30000000-0000-4000-8000-000000000001" })).rejects.toThrow("GitHub collection target loading failed");
  });

  it("never exposes phase-two evidence, finding, or Slack dependencies", () => {
    const deps = buildCollectionDependencies({ from: vi.fn(), rpc: vi.fn() } as never, { appId: "1", privateKey: "key", approvedSecurityWorkflowIds: [1] });
    expect(deps).not.toHaveProperty("createEvidence");
    expect(deps).not.toHaveProperty("saveFinding");
    expect(deps).not.toHaveProperty("deliverSlack");
  });
});
