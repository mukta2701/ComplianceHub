import { describe, expect, it } from "vitest";

import { EXPECTED_GITHUB_CHECK_IDS } from "../domain/rules";
import { githubFindingPresentation } from "./github-check-presentation";

const EXPECTED_TITLES: Record<(typeof EXPECTED_GITHUB_CHECK_IDS)[number], string> = {
  "github.repository.visibility": "Repository is publicly visible",
  "github.repository.archived": "Repository activity status needs review",
  "github.branch.force_pushes": "Force pushes are allowed",
  "github.branch.deletions": "Default branch can be deleted",
  "github.branch.approving_reviews": "Too few approving reviews are required",
  "github.branch.stale_approvals": "Stale approvals are not dismissed",
  "github.branch.code_owner_reviews": "Code-owner review is not required",
  "github.branch.status_checks": "Required status checks are missing",
  "github.dependabot.high_critical": "High or critical Dependabot alerts are open",
  "github.code_scanning.high_critical": "High or critical code-scanning alerts are open",
  "github.secret_scanning.enabled": "Secret scanning is disabled",
  "github.secret_scanning.push_protection": "Secret-scanning push protection is disabled",
  "github.secret_scanning.open_alerts": "Secret-scanning alerts are open",
  "github.workflow.security": "Security workflow is missing or failing",
  "github.administration.outside_collaborator_admins": "Outside collaborators have administrator access",
};

describe("GitHub finding presentation", () => {
  it.each(EXPECTED_GITHUB_CHECK_IDS)("provides bounded reviewed guidance for %s", (checkId) => {
    const presentation = githubFindingPresentation(checkId);
    expect(presentation.title).toBe(EXPECTED_TITLES[checkId]);
    expect(presentation.explanation.length).toBeGreaterThan(10);
    expect(presentation.remediation.length).toBeGreaterThan(10);
  });

  it("uses safe fixed wording for an unrecognised identifier", () => {
    expect(githubFindingPresentation("provider.untrusted.raw-text")).toEqual({
      title: "GitHub repository setting needs review",
      explanation: "A reviewed GitHub repository check needs attention.",
      remediation: "Review the repository setting in GitHub and record the appropriate action.",
    });
  });
});
