// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  queueGitHubConnectionNotice,
  toGitHubConnectionSlackPayload,
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
  it("explains a suspended connection and the Owner action without exposing a diagnostic code", () => {
    const payload = toGitHubConnectionSlackPayload({
      ...INCIDENT,
      health: "owner_action_required",
      diagnostic: "installation_suspended",
    });

    expect(payload.title).toBe("GitHub monitoring paused for Adtecher");
    expect(payload.detail).toContain("The GitHub App is suspended");
    expect(payload.detail).toContain("cannot check the selected repositories");
    expect(payload.detail).toContain("A workspace Owner must reactivate the App in GitHub");
    expect(payload.detail).toContain("Settings > Connections");
    expect(payload.detail).not.toContain("installation_suspended");
    expect(payload.detail).not.toContain("/app/integrations");
  });

  it("says that verified access can resume after recovery", () => {
    const payload = toGitHubConnectionSlackPayload({
      ...INCIDENT,
      kind: "recovery",
      health: "healthy",
      diagnostic: null,
    });

    expect(payload.title).toBe("GitHub monitoring restored for Adtecher");
    expect(payload.detail).toContain("GitHub access was verified again");
    expect(payload.detail).toContain("Checks can resume");
    expect(payload.detail).toContain("No action is needed");
    expect(payload.detail).not.toContain("Signal:");
  });

  it("explains a temporary GitHub limit as an automatic retry", () => {
    const payload = toGitHubConnectionSlackPayload({
      ...INCIDENT,
      health: "retrying",
      diagnostic: "provider_rate_limited",
    });

    expect(payload.title).toBe("GitHub monitoring delayed for Adtecher");
    expect(payload.detail).toContain("GitHub is temporarily limiting requests");
    expect(payload.detail).toContain("ComplianceHub will try again");
    expect(payload.detail).not.toContain("provider_rate_limited");
    expect(payload.detail).not.toContain("must reactivate");
  });

  it("asks an Owner to reconnect when GitHub access was removed", () => {
    const payload = toGitHubConnectionSlackPayload({
      ...INCIDENT,
      health: "disconnected",
      diagnostic: "installation_revoked",
    });

    expect(payload.detail).toContain("GitHub access was removed");
    expect(payload.detail).toContain("A workspace Owner must reconnect the App");
    expect(payload.detail).not.toContain("installation_revoked");
  });

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
