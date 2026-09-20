import { describe, expect, it } from "vitest";

import { presentGitHubConnectionHealth } from "./github-connection-health";

const NOW = "2026-09-18T12:00:00.000Z";

describe("presentGitHubConnectionHealth", () => {
  it("reports a healthy connection with a relative check time and no action", () => {
    expect(presentGitHubConnectionHealth({
      health: "healthy",
      diagnostic: null,
      lastSuccessfulReconciliationAt: "2026-09-18T11:55:00.000Z",
      now: NOW,
    })).toEqual({
      label: "Healthy",
      summary: "GitHub is connected and the pilot repository was checked 5 minutes ago. No action is needed.",
      nextAction: null,
      tone: "success",
      checkedAt: "18 Sep 2026, 12:55",
    });
  });

  it("says just now inside the first minute", () => {
    const presentation = presentGitHubConnectionHealth({
      health: "healthy",
      diagnostic: null,
      lastSuccessfulReconciliationAt: "2026-09-18T11:59:30.000Z",
      now: NOW,
    });
    expect(presentation.summary).toContain("just now");
  });

  it("counts hours beyond an hour and dates beyond a day", () => {
    expect(presentGitHubConnectionHealth({
      health: "healthy", diagnostic: null,
      lastSuccessfulReconciliationAt: "2026-09-18T09:00:00.000Z", now: NOW,
    }).summary).toContain("3 hours ago");
    expect(presentGitHubConnectionHealth({
      health: "healthy", diagnostic: null,
      lastSuccessfulReconciliationAt: "2026-09-15T12:00:00.000Z", now: NOW,
    }).summary).toContain("15 Sep 2026");
  });

  it("reports retrying without inventing success", () => {
    const presentation = presentGitHubConnectionHealth({
      health: "retrying",
      diagnostic: "provider_temporary_failure",
      lastSuccessfulReconciliationAt: "2026-09-18T11:00:00.000Z",
      now: NOW,
    });
    expect(presentation.label).toBe("Retrying");
    expect(presentation.tone).toBe("warning");
    expect(presentation.summary).not.toMatch(/healthy|verified|up to date/i);
    expect(presentation.nextAction).toBe("Automatic retry is scheduled; check back after the next check.");
  });

  it("names the likely cause for permission trouble", () => {
    const presentation = presentGitHubConnectionHealth({
      health: "owner_action_required",
      diagnostic: "permission_mismatch",
      lastSuccessfulReconciliationAt: null,
      now: NOW,
    });
    expect(presentation.label).toBe("Owner action required");
    expect(presentation.tone).toBe("danger");
    expect(presentation.summary).toMatch(/permission may have changed/i);
    expect(presentation.nextAction).toMatch(/owner/i);
  });

  it("reports partial loss with counts left to the scope facts, not invented", () => {
    const presentation = presentGitHubConnectionHealth({
      health: "partially_unavailable",
      diagnostic: "repository_unavailable",
      lastSuccessfulReconciliationAt: null,
      now: NOW,
    });
    expect(presentation.label).toBe("Partly unavailable");
    expect(presentation.summary).not.toMatch(/\d+ (repositor|project)/);
  });

  it("reports disconnection without claiming GitHub-side removal", () => {
    const presentation = presentGitHubConnectionHealth({
      health: "disconnected",
      diagnostic: "installation_revoked",
      lastSuccessfulReconciliationAt: "2026-09-10T12:00:00.000Z",
      now: NOW,
    });
    expect(presentation.label).toBe("Disconnected");
    expect(presentation.summary).not.toMatch(/removed from GitHub|deleted|revoked on GitHub/i);
    expect(presentation.nextAction).toMatch(/reconnect/i);
  });

  it("covers every diagnostic without inventing an action or success", () => {
    const diagnostics = [
      "provider_rate_limited", "provider_temporary_failure", "installation_suspended",
      "installation_revoked", "permission_mismatch", "account_mismatch",
      "repository_unavailable", "invalid_provider_response", "internal_failure",
    ] as const;
    const healths = ["healthy", "retrying", "partially_unavailable", "owner_action_required", "disconnected"] as const;
    for (const health of healths) {
      for (const diagnostic of diagnostics) {
        const presentation = presentGitHubConnectionHealth({
          health, diagnostic, lastSuccessfulReconciliationAt: null, now: NOW,
        });
        expect(presentation.label, `${health}/${diagnostic}`).toMatch(/^(Healthy|Retrying|Partly unavailable|Owner action required|Disconnected)$/);
        expect(presentation.tone, `${health}/${diagnostic}`).toMatch(/^(success|warning|danger|neutral)$/);
        if (health === "healthy") {
          expect(presentation.nextAction, `${health}/${diagnostic}`).toBeNull();
        } else {
          expect(presentation.nextAction, `${health}/${diagnostic}`).toMatch(/.{10,}/);
        }
      }
    }
  });

  it("rejects an invalid timestamp without presenting", () => {
    expect(() => presentGitHubConnectionHealth({
      health: "healthy", diagnostic: null, lastSuccessfulReconciliationAt: null, now: "not-a-timestamp",
    })).toThrow();
  });
});
