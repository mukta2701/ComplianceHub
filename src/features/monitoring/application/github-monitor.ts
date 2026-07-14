import { z } from "zod";
import { githubConnectionTargetSchema } from "@/features/integrations/application/connection";
import { nangoProxyFetch } from "@/features/integrations/application/nango";
import type { CheckResult, MonitorConnection, MonitorProvider } from "../domain/monitor-provider";

const repoSchema = z.object({
  default_branch: z.string().min(1).max(255),
  security_and_analysis: z.object({
    secret_scanning: z.object({ status: z.enum(["enabled", "disabled"]) }).passthrough().nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();
const protectionSchema = z.object({
  required_pull_request_reviews: z.object({
    required_approving_review_count: z.number().int().min(0),
  }).passthrough().nullable().optional(),
}).passthrough();
const organisationSchema = z.object({
  two_factor_requirement_enabled: z.boolean().optional(),
}).passthrough();

function githubRequest(connection: MonitorConnection, pathSegments: string[]) {
  return nangoProxyFetch({
    provider: "github",
    connectionId: connection.brokerConnectionId,
    providerConfigKey: connection.brokerProviderConfigKey,
    pathSegments,
    init: { method: "GET", headers: { Accept: "application/vnd.github+json" } },
  });
}

function check(input: CheckResult): CheckResult {
  return input;
}

export const githubMonitorProvider: MonitorProvider = {
  async runChecks(connection) {
    const target = githubConnectionTargetSchema.parse({
      provider: "github", owner: connection.config.owner, repo: connection.config.repo,
    });
    const repoSubject = `${target.owner}/${target.repo}`;
    const repositoryResponse = await githubRequest(connection, ["repos", target.owner, target.repo]);
    if (repositoryResponse.status === 401 || repositoryResponse.status === 403) {
      throw new Error("GitHub repository monitoring is unavailable with the granted scopes");
    }
    if (!repositoryResponse.ok) throw new Error(`GitHub repository monitoring failed: ${repositoryResponse.status}`);
    const repository = repoSchema.parse(await repositoryResponse.json());

    const protectionResponse = await githubRequest(connection, [
      "repos", target.owner, target.repo, "branches", repository.default_branch, "protection",
    ]);
    let protection: z.infer<typeof protectionSchema> | null = null;
    let protectionUnavailable = false;
    let protectionNotFound = false;
    if (protectionResponse.ok) protection = protectionSchema.parse(await protectionResponse.json());
    else if (protectionResponse.status === 401 || protectionResponse.status === 403) protectionUnavailable = true;
    else if (protectionResponse.status === 404) protectionNotFound = true;
    else throw new Error(`GitHub branch-protection check failed: ${protectionResponse.status}`);

    const organisationResponse = await githubRequest(connection, ["orgs", target.owner]);
    let organisation: z.infer<typeof organisationSchema> | null = null;
    if (organisationResponse.ok) organisation = organisationSchema.parse(await organisationResponse.json());
    else if (organisationResponse.status !== 401 && organisationResponse.status !== 403) {
      throw new Error(`GitHub organisation check failed: ${organisationResponse.status}`);
    }

    const reviews = protection?.required_pull_request_reviews?.required_approving_review_count;
    const secretStatus = repository.security_and_analysis?.secret_scanning?.status;
    const mfa = organisation?.two_factor_requirement_enabled;
    return [
      check({
        checkId: "github.branch_protection", controlRef: "A.8.32", subjectType: "github_repo", subjectId: repoSubject,
        passed: protection !== null, severity: "critical",
        title: protection !== null ? "Default branch is protected" : protectionUnavailable
          ? "Branch protection status is unavailable" : protectionNotFound
            ? "Branch protection is absent or unavailable" : "Default branch is unprotected",
        detail: protectionUnavailable
          ? "The authorization lacks permission to read branch protection; ComplianceHub cannot mark this check as passing."
          : protectionNotFound
            ? "GitHub returned 404 and cannot distinguish an absent rule from hidden settings; ComplianceHub cannot mark this check as passing."
          : protection !== null
            ? `GitHub reports protection settings for ${repository.default_branch}.`
            : `GitHub reports no protection settings for ${repository.default_branch}.`,
      }),
      check({
        checkId: "github.required_reviews", controlRef: "A.8.32", subjectType: "github_repo", subjectId: repoSubject,
        passed: typeof reviews === "number" && reviews > 0, severity: "high",
        title: protectionUnavailable ? "Required-review status is unavailable" : protectionNotFound
          ? "Required-review status is absent or unavailable" : reviews && reviews > 0
            ? "Pull-request reviews are required" : "Pull-request reviews are not required",
        detail: protectionUnavailable
          ? "The authorization lacks permission to read review enforcement; ComplianceHub cannot mark this check as passing."
          : protectionNotFound
            ? "GitHub returned 404 and cannot distinguish missing review rules from hidden settings; ComplianceHub cannot mark this check as passing."
          : `Required approving reviews: ${reviews ?? 0}.`,
      }),
      check({
        checkId: "github.secret_scanning", controlRef: "A.8.28", subjectType: "github_repo", subjectId: repoSubject,
        passed: secretStatus === "enabled", severity: "high",
        title: secretStatus === undefined ? "Secret scanning status is unavailable" : secretStatus === "enabled"
          ? "Secret scanning is enabled" : "Secret scanning is disabled",
        detail: secretStatus === undefined
          ? "GitHub did not expose secret-scanning status with the granted permissions; this check cannot be marked as passing."
          : `GitHub reports secret scanning as ${secretStatus}.`,
      }),
      check({
        checkId: "github.org_mfa", controlRef: "A.5.17", subjectType: "github_org", subjectId: target.owner,
        passed: mfa === true, severity: "high",
        title: mfa === undefined ? "Organisation MFA status is unavailable" : mfa
          ? "Organisation requires two-factor authentication" : "Organisation does not require two-factor authentication",
        detail: mfa === undefined
          ? "GitHub exposes organisation MFA enforcement only with sufficient owner/admin permission; this check cannot be marked as passing."
          : `GitHub reports organisation MFA enforcement as ${mfa ? "enabled" : "disabled"}.`,
      }),
    ];
  },
};
