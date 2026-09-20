// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  queueGitHubConnectionNotice,
  type GitHubConnectionNotice,
} from "./github-connection-alerts";

const INCIDENT: GitHubConnectionNotice = {
  kind: "incident",
  installationId: "22222222-2222-4222-8222-222222222222",
  organisationId: "33333333-3333-4333-8333-333333333333",
  accountLogin: "Adtecher",
  health: "partially_unavailable",
  diagnostic: "repository_unavailable",
  occurredAt: "2026-09-18T12:00:00.000Z",
  connectionHref: "/app/integrations",
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    resolveSlackChannelId: vi.fn().mockResolvedValue("55555555-5555-4555-8555-555555555555"),
    projectNotice: vi.fn().mockResolvedValue({
      incidentId: "44444444-4444-4444-8444-444444444444",
      isNew: true,
      notifiedUserIds: ["u1", "u2"],
      slackQueued: true,
    }),
    ...overrides,
  };
}

describe("queueGitHubConnectionNotice", () => {
  it("records one incident and queues in-app plus Slack exactly once", async () => {
    const dependencies = deps();
    const result = await queueGitHubConnectionNotice(dependencies, INCIDENT);
    expect(result).toEqual({ inAppQueued: 2, slackQueued: 1 });
    expect(dependencies.projectNotice).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: INCIDENT.organisationId,
      installationId: INCIDENT.installationId,
      kind: "incident",
      diagnostic: "repository_unavailable",
      accountLogin: "Adtecher",
      channelId: "55555555-5555-4555-8555-555555555555",
    }));
    expect(dependencies.resolveSlackChannelId).toHaveBeenCalledWith(INCIDENT.organisationId, "high");
    const payload = (dependencies.projectNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].payload as Record<string, string>;
    expect(payload.type).toBe("connection_health");
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("BEGIN");
  });

  it("sends nothing when the incident is already open", async () => {
    const dependencies = deps({
      projectNotice: vi.fn().mockResolvedValue({ incidentId: "44444444-4444-4444-8444-444444444444", isNew: false, notifiedUserIds: [], slackQueued: false }),
    });
    const result = await queueGitHubConnectionNotice(dependencies, INCIDENT);
    expect(result).toEqual({ inAppQueued: 0, slackQueued: 0 });
    expect(dependencies.projectNotice).toHaveBeenCalledTimes(1);
  });

  it("queues a recovery notice only after a genuine resolution", async () => {
    const dependencies = deps({
      projectNotice: vi.fn().mockResolvedValue({ incidentId: "44444444-4444-4444-8444-444444444444", isNew: true, notifiedUserIds: ["u1"], slackQueued: true }),
    });
    const result = await queueGitHubConnectionNotice(dependencies, { ...INCIDENT, kind: "recovery", health: "healthy", diagnostic: null });
    expect(result).toEqual({ inAppQueued: 1, slackQueued: 1 });
    expect(dependencies.projectNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: "recovery" }));
  });

  it("skips an already-resolved recovery without notifying", async () => {
    const dependencies = deps({
      projectNotice: vi.fn().mockResolvedValue({ incidentId: null, isNew: false, notifiedUserIds: [], slackQueued: false }),
    });
    const result = await queueGitHubConnectionNotice(dependencies, { ...INCIDENT, kind: "recovery", health: "healthy", diagnostic: null });
    expect(result).toEqual({ inAppQueued: 0, slackQueued: 0 });
  });

  it("does not count a duplicate Slack queue result as a new delivery", async () => {
    const dependencies = deps({
      projectNotice: vi.fn().mockResolvedValue({ incidentId: "44444444-4444-4444-8444-444444444444", isNew: true, notifiedUserIds: ["u1", "u2"], slackQueued: false }),
    });
    const result = await queueGitHubConnectionNotice(dependencies, INCIDENT);
    expect(result).toEqual({ inAppQueued: 2, slackQueued: 0 });
    expect(dependencies.projectNotice).toHaveBeenCalledTimes(1);
  });

  it("still notifies in-app when no Slack destination is configured", async () => {
    const dependencies = deps({
      resolveSlackChannelId: vi.fn().mockResolvedValue(null),
      projectNotice: vi.fn().mockResolvedValue({
        incidentId: "44444444-4444-4444-8444-444444444444",
        isNew: true,
        notifiedUserIds: ["u1", "u2"],
        slackQueued: false,
      }),
    });
    const result = await queueGitHubConnectionNotice(dependencies, INCIDENT);
    expect(result).toEqual({ inAppQueued: 2, slackQueued: 0 });
    expect(dependencies.projectNotice).toHaveBeenCalledWith(expect.objectContaining({ channelId: null }));
  });

  it("marks a disconnected installation critical and keeps safe boundaries", async () => {
    const dependencies = deps();
    await queueGitHubConnectionNotice(dependencies, { ...INCIDENT, health: "disconnected", diagnostic: "installation_revoked" });
    const payload = (dependencies.projectNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].payload as Record<string, string>;
    expect(payload.severity).toBe("critical");
    expect(payload.subjectId).toBe(INCIDENT.installationId);
  });
});
