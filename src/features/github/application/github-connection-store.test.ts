// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  claimDueReconciliations,
  finalizeReconciliationRun,
  listStoredRepositories,
  loadInstallationContext,
} from "./github-connection-store";

function clientDouble(selectResult: { data: unknown; error: unknown }, rpcResult: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(selectResult);
  const eq = vi.fn().mockImplementation(() => Object.assign(Promise.resolve(selectResult), { single }));
  const select = vi.fn().mockReturnValue({ eq, single });
  return {
    from: vi.fn().mockReturnValue({ select }),
    rpc: vi.fn().mockResolvedValue(rpcResult),
    eq,
    select,
  };
}

const INSTALLATION_UUID = "22222222-2222-4222-8222-222222222222";

describe("github-connection-store", () => {
  it("claims due runs and validates every returned row", async () => {
    const client = clientDouble(
      { data: null, error: null },
      { data: [{ id: "11111111-1111-4111-8111-111111111111", organisation_id: "33333333-3333-4333-8333-333333333333", installation_id: INSTALLATION_UUID }], error: null },
    );
    const runs = await claimDueReconciliations(client as never, {
      workerId: "99999999-9999-4999-8999-999999999999", limit: 10, nowIso: "2026-09-18T12:00:00.000Z",
    });
    expect(client.rpc).toHaveBeenCalledWith("claim_due_github_connection_reconciliations_server", {
      target_worker_id: "99999999-9999-4999-8999-999999999999",
      target_limit: 10,
      target_now: "2026-09-18T12:00:00.000Z",
    });
    expect(runs).toEqual([{
      runId: "11111111-1111-4111-8111-111111111111",
      organisationId: "33333333-3333-4333-8333-333333333333",
      installationUuid: INSTALLATION_UUID,
    }]);
  });

  it("redacts database failures instead of surfacing raw errors", async () => {
    const failing = clientDouble({ data: null, error: { message: "db-internal-secret" } }, { data: null, error: { message: "db-internal-secret" } });
    await expect(claimDueReconciliations(failing as never, {
      workerId: "99999999-9999-4999-8999-999999999999", limit: 10, nowIso: "2026-09-18T12:00:00.000Z",
    })).rejects.toThrow("GitHub reconciliation store is unavailable");
    await expect(listStoredRepositories(failing as never, INSTALLATION_UUID)).rejects.toThrow("GitHub reconciliation store is unavailable");
    try {
      await claimDueReconciliations(failing as never, {
        workerId: "99999999-9999-4999-8999-999999999999", limit: 10, nowIso: "2026-09-18T12:00:00.000Z",
      });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("db-internal-secret");
    }
  });

  it("rejects malformed run rows without persisting anything", async () => {
    const client = clientDouble({ data: null, error: null }, { data: [{ bogus: true }], error: null });
    await expect(claimDueReconciliations(client as never, {
      workerId: "99999999-9999-4999-8999-999999999999", limit: 10, nowIso: "2026-09-18T12:00:00.000Z",
    })).rejects.toThrow("GitHub reconciliation store is unavailable");
  });

  it("loads the validated installation context for reconciliation", async () => {
    const client = clientDouble(
      { data: { provider_installation_id: 77, organisation_id: "33333333-3333-4333-8333-333333333333", health: "retrying", consecutive_reconciliation_failures: 2, account_id: 99, account_login: "Adtecher", account_type: "Organization" }, error: null },
      { data: null, error: null },
    );
    const context = await loadInstallationContext(client as never, INSTALLATION_UUID);
    expect(client.from).toHaveBeenCalledWith("github_installations");
    expect(context).toEqual({
      installationUuid: INSTALLATION_UUID,
      providerInstallationId: 77,
      organisationId: "33333333-3333-4333-8333-333333333333",
      previousHealth: "retrying",
      consecutiveFailures: 2,
      expectedAccount: { id: 99, login: "Adtecher", type: "Organization" },
    });
  });

  it("lists stored repositories as provider identities", async () => {
    const client = clientDouble(
      { data: [{ provider_repository_id: 101, full_name: "Adtecher/repo-101" }, { provider_repository_id: 102, full_name: "Adtecher/repo-102" }], error: null },
      { data: null, error: null },
    );
    const repositories = await listStoredRepositories(client as never, INSTALLATION_UUID);
    expect(client.eq).toHaveBeenCalledWith("installation_id", INSTALLATION_UUID);
    expect(repositories).toEqual([
      { providerId: 101, fullName: "Adtecher/repo-101" },
      { providerId: 102, fullName: "Adtecher/repo-102" },
    ]);
  });

  it("finalises through the service RPC and returns the incident signal", async () => {
    const client = clientDouble({ data: null, error: null }, { data: "opened", error: null });
    const snapshotRow = {
      id: 101, owner: "Adtecher", name: "repo-101", fullName: "Adtecher/repo-101",
      htmlUrl: "https://github.com/Adtecher/repo-101", visibility: "private",
      archived: false, defaultBranch: "main",
    };
    const signal = await finalizeReconciliationRun(client as never, {
      runId: "11111111-1111-4111-8111-111111111111",
      workerId: "99999999-9999-4999-8999-999999999999",
      outcome: "partial",
      diagnostic: "repository_unavailable",
      nextAttemptAt: null,
      snapshot: [snapshotRow],
    });
    expect(client.rpc).toHaveBeenCalledWith("finalize_github_connection_reconciliation_server", {
      target_run_id: "11111111-1111-4111-8111-111111111111",
      target_worker_id: "99999999-9999-4999-8999-999999999999",
      target_outcome: "partial",
      target_diagnostic_code: "repository_unavailable",
      target_next_attempt_at: null,
      target_repository_snapshot: [snapshotRow],
    });
    expect(signal).toBe("opened");
  });

  it("rejects an unknown incident signal from the database", async () => {
    const client = clientDouble({ data: null, error: null }, { data: "exploded", error: null });
    await expect(finalizeReconciliationRun(client as never, {
      runId: "11111111-1111-4111-8111-111111111111",
      workerId: "99999999-9999-4999-8999-999999999999",
      outcome: "success",
      diagnostic: null,
      nextAttemptAt: null,
      snapshot: [],
    })).rejects.toThrow("GitHub reconciliation store is unavailable");
  });
});
