// Active monitoring — the provider abstraction (mirrors EvidenceProvider). A
// monitor provider inspects a connected workplace tool and returns the result of
// a fixed set of compliance CHECKS (pass/fail), each mapped to an ISO 27001
// control. The detection layer turns failed checks into findings + alerts.
//
// The fake is deterministic so re-running the checks is idempotent (a finding is
// keyed by checkId + subjectId, so re-detection upserts rather than duplicating,
// and a check that flips back to passing auto-resolves its finding).

export type MonitorProviderKind = "github";

export type CheckSeverity = "low" | "medium" | "high" | "critical";

export type MonitorConnection = {
  id: string;
  provider: MonitorProviderKind;
  config: Record<string, unknown>;
  accessToken: string;
};

export type CheckResult = {
  checkId: string; // stable id, e.g. "github.branch_protection"
  controlRef: string; // ISO 27001 Annex A reference, e.g. "A.8.32"
  subjectType: string; // e.g. "github_repo" | "github_org"
  subjectId: string; // e.g. "acme/isms" | "acme"
  passed: boolean;
  severity: CheckSeverity; // severity carried IF the check fails
  title: string; // short, human, what's wrong
  detail: string; // one sentence of context
};

export interface MonitorProvider {
  runChecks(connection: MonitorConnection): Promise<CheckResult[]>;
}

// Deterministic sample GitHub posture: three failing (critical/high/medium) and
// three passing, so a sandbox connection shows a realistic "3 of 6 passing"
// health and a mix of severities to alert on.
const GITHUB_CHECKS: ReadonlyArray<Omit<CheckResult, "subjectId">> = [
  { checkId: "github.branch_protection", controlRef: "A.8.32", subjectType: "github_repo", passed: false, severity: "critical", title: "Production branch is unprotected", detail: "The default branch 'main' has no protection rule — changes can be pushed without review or passing status checks." },
  { checkId: "github.required_reviews", controlRef: "A.8.32", subjectType: "github_repo", passed: true, severity: "high", title: "Pull-request reviews required", detail: "At least one approving review is required before a merge." },
  { checkId: "github.org_mfa", controlRef: "A.5.17", subjectType: "github_org", passed: false, severity: "high", title: "Two-factor authentication not enforced", detail: "The organisation does not require members to enable 2FA." },
  { checkId: "github.secret_scanning", controlRef: "A.8.28", subjectType: "github_repo", passed: true, severity: "high", title: "Secret scanning enabled", detail: "Push protection and secret scanning are active on the repository." },
  { checkId: "github.admin_review", controlRef: "A.8.2", subjectType: "github_org", passed: false, severity: "medium", title: "Org admin added without recorded approval", detail: "A member was granted owner access with no linked change or approval record." },
  { checkId: "github.stale_deploy_keys", controlRef: "A.8.5", subjectType: "github_repo", passed: true, severity: "medium", title: "No stale deploy keys", detail: "All deploy keys have been used within the last 90 days." },
];

function subjectFor(subjectType: string, owner: string, repo: string): string {
  return subjectType === "github_repo" ? `${owner}/${repo}` : owner;
}

export const fakeMonitorProvider: MonitorProvider = {
  async runChecks(connection) {
    const owner = typeof connection.config.owner === "string" && connection.config.owner ? connection.config.owner : "acme";
    const repo = typeof connection.config.repo === "string" && connection.config.repo ? connection.config.repo : "isms";
    return GITHUB_CHECKS.map((check) => ({ ...check, subjectId: subjectFor(check.subjectType, owner, repo) }));
  },
};
