// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  buildGitHubConnectionAlertDependencies,
  queueGitHubConnectionNotice,
  type GitHubConnectionAlertDependencies,
  type GitHubConnectionNotice,
} from "./github-connection-alerts";

const incident: GitHubConnectionNotice = {
  kind: "incident",
  runId: "20000000-0000-4000-8000-000000000001",
  installationId: "40000000-0000-4000-8000-000000000001",
  organisationId: "30000000-0000-4000-8000-000000000001",
  accountLogin: "Company-1",
  health: "owner_action_required",
  diagnostic: "permission_mismatch",
  occurredAt: "2026-09-14T12:00:00.000Z",
  connectionHref: "/app/integrations",
};

function dependencies(result: unknown = { inAppQueued: 2, slackQueued: 1 }):
GitHubConnectionAlertDependencies & { project: ReturnType<typeof vi.fn> } {
  return { project: vi.fn().mockResolvedValue(result) };
}

describe("queueGitHubConnectionNotice", () => {
  it("projects only validated incident facts through the durable database authority", async () => {
    const deps = dependencies();

    await expect(queueGitHubConnectionNotice(deps, incident)).resolves.toEqual({
      inAppQueued: 2,
      slackQueued: 1,
    });

    expect(deps.project).toHaveBeenCalledWith(incident, undefined);
  });

  it("binds the immutable reconciliation run and cancellation signal to the RPC", async () => {
    const response = { data: { inAppQueued: 0, slackQueued: 0 }, error: null };
    const query = Object.assign(Promise.resolve(response), { abortSignal: vi.fn() });
    query.abortSignal.mockReturnValue(query);
    const database = { rpc: vi.fn().mockReturnValue(query) };
    const controller = new AbortController();

    await expect(buildGitHubConnectionAlertDependencies(database)
      .project(incident, controller.signal)).resolves.toEqual(response.data);

    expect(database.rpc).toHaveBeenCalledWith("project_github_connection_notice_server", {
      target_run_id: incident.runId,
      target_organisation_id: incident.organisationId,
      target_installation_id: incident.installationId,
      target_account_login: incident.accountLogin,
      target_kind: incident.kind,
      target_health: incident.health,
      target_diagnostic_code: incident.diagnostic,
      target_occurred_at: incident.occurredAt,
    });
    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it("does not start acknowledgement when cancellation already happened", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();

    await expect(queueGitHubConnectionNotice(deps, incident, controller.signal))
      .rejects.toThrow("GitHub connection alert queue failed");
    expect(deps.project).not.toHaveBeenCalled();
  });

  it("projects verified recovery once with no stale diagnostic", async () => {
    const deps = dependencies({ inAppQueued: 2, slackQueued: 1 });
    const recovery: GitHubConnectionNotice = {
      ...incident,
      kind: "recovery",
      health: "healthy",
      diagnostic: null,
      occurredAt: "2026-09-14T13:00:00.000Z",
    };

    await queueGitHubConnectionNotice(deps, recovery);

    expect(deps.project).toHaveBeenCalledWith(expect.objectContaining({
      kind: "recovery",
      diagnostic: null,
    }), undefined);
  });

  it.each([
    { ...incident, runId: "not-a-run-id" },
    { ...incident, accountLogin: "private/body" },
    { ...incident, accountLogin: "a".repeat(40) },
    { ...incident, connectionHref: "https://secret.example.test" },
    { ...incident, kind: "recovery", health: "healthy" },
    { ...incident, kind: "incident", health: "healthy", diagnostic: null },
  ])("rejects unsafe or contradictory notice input without persistence", async (notice) => {
    const deps = dependencies();

    await expect(queueGitHubConnectionNotice(deps, notice as GitHubConnectionNotice))
      .rejects.toThrow("GitHub connection alert queue failed");
    expect(deps.project).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { inAppQueued: -1, slackQueued: 1 },
    { inAppQueued: 2, slackQueued: 1, rawError: "private" },
  ])("fails closed on a malformed persistence result", async (result) => {
    await expect(queueGitHubConnectionNotice(dependencies(result), incident))
      .rejects.toThrow("GitHub connection alert queue failed");
  });
});
