import type { ExpectedGitHubCheckId } from "../domain/rules";

export type GitHubFindingPresentation = {
  title: string;
  explanation: string;
  remediation: string;
};

const PRESENTATIONS = {
  "github.repository.visibility": {
    title: "Repository is publicly visible",
    explanation: "The repository is public and may expose source code and configuration.",
    remediation: "Restrict repository visibility unless public access is explicitly approved.",
  },
  "github.repository.archived": {
    title: "Repository activity status needs review",
    explanation: "The repository archive state needs review before active controls can be assessed.",
    remediation: "Confirm the archive state before returning the repository to active service.",
  },
  "github.branch.force_pushes": {
    title: "Force pushes are allowed",
    explanation: "Force pushes to the default branch are allowed.",
    remediation: "Block force pushes on the default branch.",
  },
  "github.branch.deletions": {
    title: "Default branch can be deleted",
    explanation: "Deletion of the default branch is allowed.",
    remediation: "Block deletion of the default branch.",
  },
  "github.branch.approving_reviews": {
    title: "Too few approving reviews are required",
    explanation: "Fewer than two approving reviews are required before merge.",
    remediation: "Require at least two approving reviews on the default branch.",
  },
  "github.branch.stale_approvals": {
    title: "Stale approvals are not dismissed",
    explanation: "Approvals remain valid after new commits are pushed.",
    remediation: "Dismiss stale approvals when new commits are pushed.",
  },
  "github.branch.code_owner_reviews": {
    title: "Code-owner review is not required",
    explanation: "Code-owner review is not required for protected changes.",
    remediation: "Require review from code owners on the default branch.",
  },
  "github.branch.status_checks": {
    title: "Required status checks are missing",
    explanation: "No status checks are required before merge.",
    remediation: "Require at least one status check on the default branch.",
  },
  "github.dependabot.high_critical": {
    title: "High or critical Dependabot alerts are open",
    explanation: "High or critical Dependabot alerts are open.",
    remediation: "Resolve or formally triage high and critical Dependabot alerts.",
  },
  "github.code_scanning.high_critical": {
    title: "High or critical code-scanning alerts are open",
    explanation: "High or critical code-scanning alerts are open.",
    remediation: "Resolve or formally triage high and critical code-scanning alerts.",
  },
  "github.secret_scanning.enabled": {
    title: "Secret scanning is disabled",
    explanation: "Secret scanning is disabled.",
    remediation: "Enable GitHub secret scanning for this repository.",
  },
  "github.secret_scanning.push_protection": {
    title: "Secret-scanning push protection is disabled",
    explanation: "Secret-scanning push protection is disabled.",
    remediation: "Enable push protection for GitHub secret scanning.",
  },
  "github.secret_scanning.open_alerts": {
    title: "Secret-scanning alerts are open",
    explanation: "Secret-scanning alerts are open.",
    remediation: "Resolve or formally triage all open secret-scanning alerts.",
  },
  "github.workflow.security": {
    title: "Security workflow is missing or failing",
    explanation: "No approved, active security workflow has completed successfully.",
    remediation: "Enable an approved security workflow and resolve its failures.",
  },
  "github.administration.outside_collaborator_admins": {
    title: "Outside collaborators have administrator access",
    explanation: "Outside collaborators have administrator access.",
    remediation: "Remove administrator access from outside collaborators.",
  },
} satisfies Record<ExpectedGitHubCheckId, GitHubFindingPresentation>;

const UNKNOWN_PRESENTATION: GitHubFindingPresentation = {
  title: "GitHub repository setting needs review",
  explanation: "A reviewed GitHub repository check needs attention.",
  remediation: "Review the repository setting in GitHub and record the appropriate action.",
};

export function githubFindingPresentation(checkId: string): GitHubFindingPresentation {
  return Object.prototype.hasOwnProperty.call(PRESENTATIONS, checkId)
    ? PRESENTATIONS[checkId as ExpectedGitHubCheckId]
    : UNKNOWN_PRESENTATION;
}

const EVIDENCE_TITLES = {
  "github.repository.visibility": "Repository visibility",
  "github.repository.archived": "Repository activity",
  "github.branch.force_pushes": "Force-push protection",
  "github.branch.deletions": "Branch deletion protection",
  "github.branch.approving_reviews": "Required approving reviews",
  "github.branch.stale_approvals": "Stale approval handling",
  "github.branch.code_owner_reviews": "Code-owner reviews",
  "github.branch.status_checks": "Required status checks",
  "github.dependabot.high_critical": "Dependency security alerts",
  "github.code_scanning.high_critical": "Code-scanning alerts",
  "github.secret_scanning.enabled": "Secret scanning",
  "github.secret_scanning.push_protection": "Secret push protection",
  "github.secret_scanning.open_alerts": "Open secret-scanning alerts",
  "github.workflow.security": "Security workflow",
  "github.administration.outside_collaborator_admins": "Outside collaborator access",
} satisfies Record<ExpectedGitHubCheckId, string>;

export function githubEvidenceTitle(checkId: string): string {
  return Object.prototype.hasOwnProperty.call(EVIDENCE_TITLES, checkId)
    ? EVIDENCE_TITLES[checkId as ExpectedGitHubCheckId]
    : "Repository check";
}

export type GitHubCheckGroup = {
  id: string;
  title: string;
};

const CHECK_GROUPS = [
  {
    id: "repository",
    title: "Repository basics",
    checkIds: ["github.repository.visibility", "github.repository.archived"],
  },
  {
    id: "branch",
    title: "Branch protection",
    checkIds: [
      "github.branch.force_pushes",
      "github.branch.deletions",
      "github.branch.approving_reviews",
      "github.branch.stale_approvals",
      "github.branch.code_owner_reviews",
      "github.branch.status_checks",
    ],
  },
  {
    id: "alerts",
    title: "Dependency and code alerts",
    checkIds: ["github.dependabot.high_critical", "github.code_scanning.high_critical"],
  },
  {
    id: "secrets",
    title: "Secret protection",
    checkIds: [
      "github.secret_scanning.enabled",
      "github.secret_scanning.push_protection",
      "github.secret_scanning.open_alerts",
    ],
  },
  {
    id: "governance",
    title: "Workflows and access",
    checkIds: [
      "github.workflow.security",
      "github.administration.outside_collaborator_admins",
    ],
  },
] satisfies Array<{ id: string; title: string; checkIds: ExpectedGitHubCheckId[] }>;

const UNKNOWN_GROUP: GitHubCheckGroup = { id: "other", title: "Other checks" };

export const GITHUB_CHECK_GROUPS: GitHubCheckGroup[] = [
  ...CHECK_GROUPS.map(({ id, title }) => ({ id, title })),
  UNKNOWN_GROUP,
];

export function githubCheckGroup(checkId: string): GitHubCheckGroup {
  const group = CHECK_GROUPS.find((candidate) => (candidate.checkIds as string[]).includes(checkId));
  return group ? { id: group.id, title: group.title } : UNKNOWN_GROUP;
}

export function groupChecksByArea<T extends { checkId: string }>(
  items: T[],
): Array<{ group: GitHubCheckGroup; items: T[] }> {
  return GITHUB_CHECK_GROUPS
    .map((group) => ({
      group,
      items: items.filter((item) => githubCheckGroup(item.checkId).id === group.id),
    }))
    .filter((section) => section.items.length > 0);
}

const VERIFY_HINTS = {
  "github.repository.visibility": "GitHub → the repository Settings → General → Danger Zone (Change visibility).",
  "github.repository.archived": "GitHub → the repository Settings → General → Archive/Unarchive repository.",
  "github.branch.force_pushes": "GitHub → the repository Settings → Rules → branch rules for the default branch.",
  "github.branch.deletions": "GitHub → the repository Settings → Rules → branch rules for the default branch.",
  "github.branch.approving_reviews": "GitHub → the repository Settings → Rules → branch rules for the default branch.",
  "github.branch.stale_approvals": "GitHub → the repository Settings → Rules → branch rules for the default branch.",
  "github.branch.code_owner_reviews": "GitHub → the repository Settings → Rules → branch rules for the default branch.",
  "github.branch.status_checks": "GitHub → the repository Settings → Rules → branch rules for the default branch.",
  "github.dependabot.high_critical": "GitHub → the repository Security tab → Dependabot alerts.",
  "github.code_scanning.high_critical": "GitHub → the repository Security tab → Code scanning alerts.",
  "github.secret_scanning.enabled": "GitHub → the repository Settings → Code security → Secret scanning.",
  "github.secret_scanning.push_protection": "GitHub → the repository Settings → Code security → Push protection.",
  "github.secret_scanning.open_alerts": "GitHub → the repository Security tab → Secret scanning alerts.",
  "github.workflow.security": "GitHub → the repository Actions tab → the approved security workflow runs.",
  "github.administration.outside_collaborator_admins": "GitHub → the organisation People page and the repository Settings → Collaborators.",
} satisfies Record<ExpectedGitHubCheckId, string>;

const UNKNOWN_VERIFY_HINT = "GitHub → the repository Settings and Security tab.";

export function githubVerifyHint(checkId: string): string {
  return Object.prototype.hasOwnProperty.call(VERIFY_HINTS, checkId)
    ? VERIFY_HINTS[checkId as ExpectedGitHubCheckId]
    : UNKNOWN_VERIFY_HINT;
}
