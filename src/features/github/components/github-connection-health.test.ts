import { describe, expect, it } from "vitest";

import { presentGitHubConnectionHealth } from "./github-connection-health";

const now = "2026-09-15T12:00:00.000Z";

describe("presentGitHubConnectionHealth", () => {
  it("presents a healthy connection only when the authoritative successful check is valid", () => {
    expect(presentGitHubConnectionHealth({
      health: "healthy",
      diagnostic: null,
      lastSuccessfulReconciliationAt: "2026-09-15T11:55:00.000Z",
      now,
    })).toEqual({
      label: "Healthy",
      summary: "GitHub is connected and was checked 5 minutes ago. No action is needed.",
      nextAction: null,
      tone: "success",
      checkedAt: "5 minutes ago",
    });

    expect(presentGitHubConnectionHealth({
      health: "healthy",
      diagnostic: null,
      lastSuccessfulReconciliationAt: "not-a-time",
      now,
    })).toEqual(expect.objectContaining({
      summary: "GitHub is connected. Reconciliation freshness is not available yet.",
      checkedAt: null,
    }));
  });

  it.each([
    ["just now", "2026-09-15T12:00:00.000Z"],
    ["just now", "2026-09-15T11:59:01.000Z"],
    ["1 minute ago", "2026-09-15T11:59:00.000Z"],
    ["59 minutes ago", "2026-09-15T11:01:00.000Z"],
    ["1 hour ago", "2026-09-15T11:00:00.000Z"],
    ["2 hours ago", "2026-09-15T10:00:00.000Z"],
    ["1 day ago", "2026-09-14T12:00:00.000Z"],
  ])("uses deterministic relative time at the %s boundary", (checkedAt, lastSuccessfulReconciliationAt) => {
    expect(presentGitHubConnectionHealth({
      health: "healthy",
      diagnostic: null,
      lastSuccessfulReconciliationAt,
      now,
    }).checkedAt).toBe(checkedAt);
  });

  it.each([
    "provider_rate_limited",
    "provider_temporary_failure",
    "invalid_provider_response",
    "internal_failure",
  ] as const)("does not invent an Owner task while retrying %s", (diagnostic) => {
    expect(presentGitHubConnectionHealth({
      health: "retrying",
      diagnostic,
      lastSuccessfulReconciliationAt: null,
      now,
    })).toEqual({
      label: "Retrying",
      summary: "ComplianceHub cannot currently verify GitHub access. We are retrying automatically.",
      nextAction: null,
      tone: "warning",
      checkedAt: null,
    });
  });

  it("explains partial repository availability without treating the remaining scope as failed", () => {
    expect(presentGitHubConnectionHealth({
      health: "partially_unavailable",
      diagnostic: "repository_unavailable",
      lastSuccessfulReconciliationAt: null,
      now,
    })).toEqual({
      label: "Partly unavailable",
      summary: "One or more repositories cannot be verified. Other available repositories may still be usable.",
      nextAction: null,
      tone: "warning",
      checkedAt: null,
    });
  });

  it.each([
    ["installation_suspended", "GitHub has suspended this App installation.", "Ask a workspace Owner to review the GitHub App installation."],
    ["permission_mismatch", "GitHub App permissions no longer match the approved read-only access.", "Ask a workspace Owner to review the GitHub App permissions."],
    ["account_mismatch", "The connected GitHub account no longer matches this workspace.", "Ask a workspace Owner to reconnect the approved GitHub organisation."],
  ] as const)("gives diagnostic-specific Owner guidance for %s", (diagnostic, summary, nextAction) => {
    expect(presentGitHubConnectionHealth({
      health: "owner_action_required",
      diagnostic,
      lastSuccessfulReconciliationAt: null,
      now,
    })).toEqual({
      label: "Owner action required",
      summary,
      nextAction,
      tone: "danger",
      checkedAt: null,
    });
  });

  it("never claims that GitHub uninstalled the App after ComplianceHub is disconnected", () => {
    const presentation = presentGitHubConnectionHealth({
      health: "disconnected",
      diagnostic: "installation_revoked",
      lastSuccessfulReconciliationAt: "2026-09-15T10:00:00.000Z",
      now,
    });

    expect(presentation).toEqual({
      label: "Disconnected",
      summary: "ComplianceHub is disconnected from this GitHub installation.",
      nextAction: "A workspace Owner can reconnect when GitHub access is ready.",
      tone: "neutral",
      checkedAt: "2 hours ago",
    });
    expect(`${presentation.summary} ${presentation.nextAction}`).not.toMatch(/uninstalled|removed/i);
  });
});
