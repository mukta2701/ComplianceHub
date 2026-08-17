import { createHash } from "node:crypto";

import type {
  DataState,
  DiagnosticCode,
  GitHubFactSet,
  GitHubObservation,
  ObservationResult,
  ObservationSeverity,
} from "./observation";

export const RULE_PACK_VERSION = "github-repository-v1";

export const EXPECTED_GITHUB_CHECK_IDS = [
  "github.repository.visibility",
  "github.repository.archived",
  "github.branch.force_pushes",
  "github.branch.deletions",
  "github.branch.approving_reviews",
  "github.branch.stale_approvals",
  "github.branch.code_owner_reviews",
  "github.branch.status_checks",
  "github.dependabot.high_critical",
  "github.code_scanning.high_critical",
  "github.secret_scanning.enabled",
  "github.secret_scanning.push_protection",
  "github.secret_scanning.open_alerts",
  "github.workflow.security",
  "github.administration.outside_collaborator_admins",
] as const;

type EvaluationContext = {
  runId: string;
  observedAt: string;
};

type RuleContext = EvaluationContext & {
  facts: GitHubFactSet;
  checkId: string;
  title: string;
  fingerprintData: unknown;
};

type ObservationDetails = {
  result: ObservationResult;
  severity: ObservationSeverity | null;
  explanation: string;
  remediation: string | null;
  diagnosticCode: DiagnosticCode | null;
};

type RuleDefinition<T> = {
  checkId: string;
  title: string;
  evaluate: (value: T) => ObservationDetails;
};

const FRESHNESS_MS = 36 * 60 * 60 * 1000;
const ISO_8601_DATE_TIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function normalizeEvaluationContext(context: EvaluationContext): EvaluationContext {
  if (!ISO_8601_DATE_TIME_WITH_ZONE.test(context.observedAt)) {
    throw new TypeError("observedAt must be a valid ISO 8601 timestamp");
  }

  const observedAt = new Date(context.observedAt);

  if (!Number.isFinite(observedAt.getTime())) {
    throw new TypeError("observedAt must be a valid ISO 8601 timestamp");
  }

  return { ...context, observedAt: observedAt.toISOString() };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function observation(input: RuleContext, details: ObservationDetails): GitHubObservation {
  const { repository } = input.facts;

  return {
    observationKey: `${repository.owner}/${repository.name}/${input.checkId}/${RULE_PACK_VERSION}`,
    runId: input.runId,
    repositoryId: repository.id,
    checkId: input.checkId,
    ruleVersion: RULE_PACK_VERSION,
    subjectType: "github_repository",
    subjectId: `${repository.owner}/${repository.name}`,
    result: details.result,
    severity: details.severity,
    title: input.title,
    explanation: details.explanation,
    remediation: details.remediation,
    observedAt: input.observedAt,
    freshUntil: new Date(new Date(input.observedAt).getTime() + FRESHNESS_MS).toISOString(),
    sourceUrl: repository.url,
    fingerprint: sha256({
      checkId: input.checkId,
      ruleVersion: RULE_PACK_VERSION,
      subjectId: `${repository.owner}/${repository.name}`,
      details,
      facts: input.fingerprintData,
    }),
    diagnosticCode: details.diagnosticCode,
  };
}

function unknown(input: RuleContext, diagnosticCode: DiagnosticCode): GitHubObservation {
  return observation(input, {
    result: "unknown",
    severity: null,
    explanation: "GitHub did not provide enough verified information for this check.",
    remediation: "Restore the required GitHub App permission or feature, then run collection again.",
    diagnosticCode,
  });
}

function notApplicable(input: RuleContext): GitHubObservation {
  return observation(input, {
    result: "not_applicable",
    severity: null,
    explanation: "This repository is archived, so active runtime controls do not apply.",
    remediation: null,
    diagnosticCode: null,
  });
}

function pass(explanation: string): ObservationDetails {
  return {
    result: "pass",
    severity: null,
    explanation,
    remediation: null,
    diagnosticCode: null,
  };
}

function fail(
  severity: ObservationSeverity,
  explanation: string,
  remediation: string,
): ObservationDetails {
  return {
    result: "fail",
    severity,
    explanation,
    remediation,
    diagnosticCode: null,
  };
}

function evaluateDataRule<T>(
  facts: GitHubFactSet,
  context: EvaluationContext,
  data: DataState<T>,
  definition: RuleDefinition<T>,
): GitHubObservation {
  const input: RuleContext = {
    ...context,
    facts,
    checkId: definition.checkId,
    title: definition.title,
    fingerprintData: data,
  };

  if (facts.repository.archived) {
    return notApplicable(input);
  }

  if (data.state === "unavailable") {
    return unknown(input, data.diagnosticCode);
  }

  return observation(input, definition.evaluate(data.value));
}

export function evaluateGitHubRepository(
  facts: GitHubFactSet,
  context: EvaluationContext,
): GitHubObservation[] {
  const normalizedContext = normalizeEvaluationContext(context);
  const repositoryInput = (checkId: string, title: string): RuleContext => ({
    ...normalizedContext,
    facts,
    checkId,
    title,
    fingerprintData: facts.repository,
  });

  const visibility = observation(
    repositoryInput("github.repository.visibility", "Repository visibility is restricted"),
    facts.repository.visibility === "public"
      ? fail(
          "high",
          "The repository is public and may expose source code and configuration.",
          "Restrict repository visibility unless public access is explicitly approved.",
        )
      : pass("The repository visibility is restricted to authenticated GitHub users."),
  );

  const archive = observation(
    repositoryInput("github.repository.archived", "Repository is active"),
    facts.repository.archived
      ? {
          result: "not_applicable",
          severity: null,
          explanation: "This repository is archived, so active runtime controls do not apply.",
          remediation: null,
          diagnosticCode: null,
        }
      : pass("The repository is active and its runtime controls are evaluated."),
  );

  return [
    visibility,
    archive,
    evaluateDataRule(facts, normalizedContext, facts.branchProtection, {
      checkId: "github.branch.force_pushes",
      title: "Force pushes are blocked",
      evaluate: (value) =>
        value.forcePushesBlocked
          ? pass("Force pushes to the default branch are blocked.")
          : fail("high", "Force pushes to the default branch are allowed.", "Block force pushes on the default branch."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.branchProtection, {
      checkId: "github.branch.deletions",
      title: "Branch deletions are blocked",
      evaluate: (value) =>
        value.deletionsBlocked
          ? pass("Deletion of the default branch is blocked.")
          : fail("high", "Deletion of the default branch is allowed.", "Block deletion of the default branch."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.branchProtection, {
      checkId: "github.branch.approving_reviews",
      title: "Two approving reviews are required",
      evaluate: (value) =>
        value.approvingReviews >= 2
          ? pass("At least two approving reviews are required before merge.")
          : fail("high", "Fewer than two approving reviews are required before merge.", "Require at least two approving reviews on the default branch."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.branchProtection, {
      checkId: "github.branch.stale_approvals",
      title: "Stale approvals are dismissed",
      evaluate: (value) =>
        value.dismissesStaleReviews
          ? pass("Approvals are dismissed when new commits are pushed.")
          : fail("medium", "Approvals remain valid after new commits are pushed.", "Dismiss stale approvals when new commits are pushed."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.branchProtection, {
      checkId: "github.branch.code_owner_reviews",
      title: "Code-owner review is required",
      evaluate: (value) =>
        value.codeOwnerReviews
          ? pass("Code-owner review is required for protected changes.")
          : fail("medium", "Code-owner review is not required for protected changes.", "Require review from code owners on the default branch."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.branchProtection, {
      checkId: "github.branch.status_checks",
      title: "Status checks are required",
      evaluate: (value) =>
        value.requiredStatusChecks.length > 0
          ? pass("At least one status check is required before merge.")
          : fail("high", "No status checks are required before merge.", "Require at least one status check on the default branch."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.dependabot, {
      checkId: "github.dependabot.high_critical",
      title: "No high or critical Dependabot alerts are open",
      evaluate: (value) =>
        value.openHigh === 0 && value.openCritical === 0
          ? pass("No high or critical Dependabot alerts are open.")
          : fail("high", "High or critical Dependabot alerts are open.", "Resolve or formally triage high and critical Dependabot alerts."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.codeScanning, {
      checkId: "github.code_scanning.high_critical",
      title: "No high or critical code-scanning alerts are open",
      evaluate: (value) =>
        value.openHigh === 0 && value.openCritical === 0
          ? pass("No high or critical code-scanning alerts are open.")
          : fail("high", "High or critical code-scanning alerts are open.", "Resolve or formally triage high and critical code-scanning alerts."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.secretScanningConfiguration, {
      checkId: "github.secret_scanning.enabled",
      title: "Secret scanning is enabled",
      evaluate: (value) =>
        value.enabled
          ? pass("Secret scanning is enabled.")
          : fail("critical", "Secret scanning is disabled.", "Enable GitHub secret scanning for this repository."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.secretScanningPushProtection, {
      checkId: "github.secret_scanning.push_protection",
      title: "Secret-scanning push protection is enabled",
      evaluate: (value) =>
        value.enabled
          ? pass("Secret-scanning push protection is enabled.")
          : fail("critical", "Secret-scanning push protection is disabled.", "Enable push protection for GitHub secret scanning."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.secretScanningAlerts, {
      checkId: "github.secret_scanning.open_alerts",
      title: "No secret-scanning alerts are open",
      evaluate: (value) =>
        value.openAlerts === 0
          ? pass("No secret-scanning alerts are open.")
          : fail("critical", "Secret-scanning alerts are open.", "Resolve or formally triage all open secret-scanning alerts."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.securityWorkflows, {
      checkId: "github.workflow.security",
      title: "An approved security workflow is active and successful",
      evaluate: (value) =>
        value.some(
          (workflow) =>
            workflow.approved && workflow.active && workflow.latestConclusion === "success",
        )
          ? pass("At least one approved, active security workflow completed successfully.")
          : fail("high", "No approved, active security workflow has completed successfully.", "Enable an approved security workflow and resolve its failures."),
    }),
    evaluateDataRule(facts, normalizedContext, facts.administration, {
      checkId: "github.administration.outside_collaborator_admins",
      title: "No outside collaborators have administrator access",
      evaluate: (value) =>
        value.outsideCollaboratorAdmins === 0
          ? pass("No outside collaborators have administrator access.")
          : fail("high", "Outside collaborators have administrator access.", "Remove administrator access from outside collaborators."),
    }),
  ];
}
