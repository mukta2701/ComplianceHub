// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  claimDueReconciliations,
  finalizeReconciliationRun,
  listSelectedRepositoryIds,
  listStoredRepositories,
  loadInstallationContext,
  scheduleConnectionReconciliation,
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
  it("disables PostgREST retry backoff and binds the shared deadline signal", async () => {
    const controller = new AbortController();
    const query = Object.assign(Promise.resolve({
      data: {
        provider_installation_id: 77,
        organisation_id: "33333333-3333-4333-8333-333333333333",
        health: "healthy",
        consecutive_reconciliation_failures: 0,
        account_id: 99,
        account_login: "Adtecher",
        account_type: "Organization",
      },
      error: null,
    }), {
      retry: vi.fn(),
      abortSignal: vi.fn(),
    });
    query.retry.mockImplementation(() => query);
    query.abortSignal.mockImplementation(() => query);
    const client = {
      from: vi.fn().mockReturnValue({
        select: () => ({
          eq: () => ({ single: () => query }),
        }),
      }),
      rpc: vi.fn(),
    };
    await expect(loadInstallationContext(client as never, INSTALLATION_UUID, controller.signal)).resolves.toMatchObject({
      providerInstallationId: 77,
    });
    expect(query.retry).toHaveBeenCalledWith(false);
    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

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

describe("connection scheduling helpers", () => {
  it("schedules reconciliation through the service RPC", async () => {
    const client = clientDouble({ data: null, error: null }, { data: true, error: null });
    await expect(scheduleConnectionReconciliation(client as never, 77)).resolves.toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("schedule_github_connection_reconciliation_server", {
      target_provider_installation_id: 77,
    });
  });

  it("rejects an invalid installation identifier without calling the database", async () => {
    const client = clientDouble({ data: null, error: null }, { data: true, error: null });
    await expect(scheduleConnectionReconciliation(client as never, 0)).rejects.toThrow(
      "GitHub reconciliation store is unavailable",
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("lists at most 100 selected available repository ids in canonical order", async () => {
    const client = clientDouble(
      {
        data: [
          { provider_repository_id: 103, selected: true, available: true },
          { provider_repository_id: 101, selected: true, available: true },
          { provider_repository_id: 102, selected: false, available: true },
          { provider_repository_id: 104, selected: true, available: false },
        ],
        error: null,
      },
      { data: null, error: null },
    );
    await expect(listSelectedRepositoryIds(client as never, "22222222-2222-4222-8222-222222222222")).resolves.toEqual([101, 103]);
    expect(client.eq).toHaveBeenCalledWith("installation_id", "22222222-2222-4222-8222-222222222222");
  });
});

describe("connection notice recording", () => {
  it("records an incident notice through the service RPC", async () => {
    const client = clientDouble({ data: null, error: null }, {
      data: { incident_id: "44444444-4444-4444-8444-444444444444", is_new: true, notified_user_ids: ["66666666-6666-4666-8666-666666666666"] },
      error: null,
    });
    const { recordConnectionNotice } = await import("./github-connection-store");
    const result = await recordConnectionNotice(client as never, {
      organisationId: "33333333-3333-4333-8333-333333333333",
      installationId: "22222222-2222-4222-8222-222222222222",
      kind: "incident",
      diagnostic: "repository_unavailable",
      accountLogin: "Adtecher",
    });
    expect(client.rpc).toHaveBeenCalledWith("record_github_connection_notice_server", {
      target_organisation_id: "33333333-3333-4333-8333-333333333333",
      target_installation_id: "22222222-2222-4222-8222-222222222222",
      target_kind: "incident",
      target_diagnostic_code: "repository_unavailable",
      target_account_login: "Adtecher",
    });
    expect(result).toEqual({
      incidentId: "44444444-4444-4444-8444-444444444444",
      isNew: true,
      notifiedUserIds: ["66666666-6666-4666-8666-666666666666"],
    });
  });

  it("resolves the Slack channel to the first enabled destination", async () => {
    const client = clientDouble(
      { data: [{ id: "55555555-5555-4555-8555-555555555555", type: "slack", enabled: true, revoked_at: null }], error: null },
      { data: null, error: null },
    );
    const { resolveConnectionSlackChannel } = await import("./github-connection-store");
    await expect(resolveConnectionSlackChannel(client as never, "33333333-3333-4333-8333-333333333333")).resolves.toBe(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(client.from).toHaveBeenCalledWith("alert_channels");
  });

  it("returns null when no Slack destination is configured", async () => {
    const client = clientDouble({ data: [], error: null }, { data: null, error: null });
    const { resolveConnectionSlackChannel } = await import("./github-connection-store");
    await expect(resolveConnectionSlackChannel(client as never, "33333333-3333-4333-8333-333333333333")).resolves.toBeNull();
  });

  it("queues a connection Slack alert and returns whether it was newly queued", async () => {
    const client = clientDouble(
      { data: null, error: null },
      { data: true, error: null },
    );
    const { enqueueConnectionSlackAlert } = await import("./github-connection-store");
    const queued = await enqueueConnectionSlackAlert(client as never, {
      organisationId: "33333333-3333-4333-8333-333333333333",
      channelId: "55555555-5555-4555-8555-555555555555",
      installationId: "22222222-2222-4222-8222-222222222222",
      kind: "incident",
      diagnostic: "permission_mismatch",
      payload: {
        type: "connection_health",
        severity: "high",
        title: "GitHub connection needs attention",
        controlRef: "GitHub connection",
        subjectId: "22222222-2222-4222-8222-222222222222",
        detail: "Access needs an Owner decision.",
      },
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "queue_github_connection_alert_delivery",
      expect.objectContaining({
        target_organisation_id: "33333333-3333-4333-8333-333333333333",
        target_channel_id: "55555555-5555-4555-8555-555555555555",
        target_installation_id: "22222222-2222-4222-8222-222222222222",
        target_kind: "incident",
        target_diagnostic_code: "permission_mismatch",
      }),
    );
    expect(queued).toBe(true);
  });

  it("returns false when an identical alert is already queued", async () => {
    const client = clientDouble({ data: null, error: null }, { data: false, error: null });
    const { enqueueConnectionSlackAlert } = await import("./github-connection-store");
    await expect(enqueueConnectionSlackAlert(client as never, {
      organisationId: "33333333-3333-4333-8333-333333333333",
      channelId: "55555555-5555-4555-8555-555555555555",
      installationId: "22222222-2222-4222-8222-222222222222",
      kind: "incident",
      diagnostic: null,
      payload: {
        type: "connection_health",
        severity: "high",
        title: "GitHub connection needs attention",
        controlRef: "GitHub connection",
        subjectId: "22222222-2222-4222-8222-222222222222",
        detail: "Access needs an Owner decision.",
      },
    })).resolves.toBe(false);
  });

  it("redacts connection queue database errors and rejects non-boolean results", async () => {
    const databaseError = clientDouble({ data: null, error: null }, { data: null, error: { message: "db-internal-secret" } });
    const { enqueueConnectionSlackAlert } = await import("./github-connection-store");
    const input = {
      organisationId: "33333333-3333-4333-8333-333333333333",
      channelId: "55555555-5555-4555-8555-555555555555",
      installationId: "22222222-2222-4222-8222-222222222222",
      kind: "incident" as const,
      diagnostic: "permission_mismatch" as const,
      payload: {
        type: "connection_health" as const,
        severity: "high" as const,
        title: "GitHub connection needs attention",
        controlRef: "GitHub connection",
        subjectId: "22222222-2222-4222-8222-222222222222",
        detail: "Access needs an Owner decision.",
      },
    };
    await expect(enqueueConnectionSlackAlert(databaseError as never, input)).rejects.toThrow(
      "Connection alert delivery queue failed",
    );
    try {
      await enqueueConnectionSlackAlert(databaseError as never, input);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("db-internal-secret");
    }
    const malformed = clientDouble({ data: null, error: null }, { data: "true", error: null });
    await expect(enqueueConnectionSlackAlert(malformed as never, input)).rejects.toThrow(
      "Connection alert delivery queue failed",
    );
  });
});
