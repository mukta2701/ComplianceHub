import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedIntegrationSyncJob } from "@/features/integrations/application/sync-jobs";

const hoisted = vi.hoisted(() => ({
  buildMonitorDependencies: vi.fn(),
  runMonitoring: vi.fn(),
}));

vi.mock("./monitor-deps", () => ({ buildMonitorDependencies: hoisted.buildMonitorDependencies }));
vi.mock("./monitor-run", async () => {
  const actual = await vi.importActual<typeof import("./monitor-run")>("./monitor-run");
  return { ...actual, runMonitoring: hoisted.runMonitoring };
});

import { syncJiraMonitorTarget } from "./jira-target-sync";

const organisationId = "10000000-0000-4000-8000-000000000001";
const connectionId = "10000000-0000-4000-8000-000000000002";
const targetId = "10000000-0000-4000-8000-000000000003";
const sourceId = "10000000-0000-4000-8000-000000000004";
const cloudId = "1324a887-45db-4bf4-8e99-ef0ff456d421";

function job(): ClaimedIntegrationSyncJob {
  return {
    jobId: "10000000-0000-4000-8000-000000000005",
    organisationId,
    provider: "jira",
    connectionId,
    targetId,
    kind: "target_sync",
    payload: {},
    attemptCount: 1,
    lockedBy: "worker",
    lockToken: "10000000-0000-4000-8000-000000000006",
    webhookDeliveryId: null,
    idempotencyKey: "sync-1",
  };
}

function database() {
  const rows: Record<string, unknown> = {
    integration_connection_targets: {
      id: targetId,
      organisation_id: organisationId,
      connection_id: connectionId,
      provider: "jira",
      config: { baseUrl: "https://acme.atlassian.net", cloudId, projectKey: "SEC" },
      enabled: true,
      revoked_at: null,
    },
    integration_connections: {
      id: connectionId,
      organisation_id: organisationId,
      provider: "jira",
      provider_account_id: cloudId,
      connection_mode: "jira_oauth",
      enabled: true,
      revoked_at: null,
    },
    monitor_sources: {
      id: sourceId,
      organisation_id: organisationId,
      integration_connection_target_id: targetId,
      provider: "jira",
      connection_mode: "jira_oauth",
      enabled: true,
      revoked_at: null,
    },
  };
  return {
    from: vi.fn((table: string) => {
      const query: Record<string, unknown> = {};
      query.select = vi.fn(() => query);
      query.eq = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => ({ data: rows[table], error: null }));
      return query;
    }),
    rpc: vi.fn(),
  };
}

describe("Jira monitor target synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.buildMonitorDependencies.mockReturnValue({});
    hoisted.runMonitoring.mockResolvedValue({ sourcesChecked: 1 });
  });

  it("loads the same tenant target and runs only its Jira checks", async () => {
    const runChecks = vi.fn().mockResolvedValue([
      {
        checkId: "jira.overdue_unresolved",
        controlRef: "A.5.24",
        subjectType: "jira_project",
        subjectId: `${cloudId}:SEC`,
        passed: true,
        severity: "high",
        title: "No overdue unresolved issues found",
        detail: "Jira returned no matching unresolved issues in SEC.",
      },
    ]);
    const result = await syncJiraMonitorTarget(database(), job(), undefined, {
      getAccessToken: vi.fn().mockResolvedValue("access-token"),
      runChecks,
    });

    expect(result).toEqual({ sourcesChecked: 1 });
    const dependencies = hoisted.runMonitoring.mock.calls[0]?.[0] as { runChecks: () => Promise<unknown> };
    await dependencies.runChecks();
    expect(runChecks).toHaveBeenCalledWith(expect.objectContaining({
      provider: "jira",
      connectionMode: "jira_oauth",
      config: { baseUrl: "https://acme.atlassian.net", cloudId, projectKey: "SEC" },
    }), undefined);
    expect(hoisted.buildMonitorDependencies).toHaveBeenCalledWith(expect.anything(), { organisationId });
    expect(hoisted.runMonitoring).toHaveBeenCalledOnce();
  });
});
