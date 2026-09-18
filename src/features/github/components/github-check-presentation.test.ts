import { describe, expect, it } from "vitest";

import { EXPECTED_GITHUB_CHECK_IDS } from "../domain/rules";
import {
  GITHUB_CHECK_GROUPS,
  githubCheckGroup,
  githubFindingPresentation,
  githubVerifyHint,
  groupChecksByArea,
} from "./github-check-presentation";

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

const EXPECTED_GROUPS: Record<(typeof EXPECTED_GITHUB_CHECK_IDS)[number], string> = {
  "github.repository.visibility": "Repository basics",
  "github.repository.archived": "Repository basics",
  "github.branch.force_pushes": "Branch protection",
  "github.branch.deletions": "Branch protection",
  "github.branch.approving_reviews": "Branch protection",
  "github.branch.stale_approvals": "Branch protection",
  "github.branch.code_owner_reviews": "Branch protection",
  "github.branch.status_checks": "Branch protection",
  "github.dependabot.high_critical": "Dependency and code alerts",
  "github.code_scanning.high_critical": "Dependency and code alerts",
  "github.secret_scanning.enabled": "Secret protection",
  "github.secret_scanning.push_protection": "Secret protection",
  "github.secret_scanning.open_alerts": "Secret protection",
  "github.workflow.security": "Workflows and access",
  "github.administration.outside_collaborator_admins": "Workflows and access",
};

describe("GitHub check grouping and verification guidance", () => {
  it.each(EXPECTED_GITHUB_CHECK_IDS)("places %s in one named area", (checkId) => {
    expect(githubCheckGroup(checkId).title).toBe(EXPECTED_GROUPS[checkId]);
  });

  it.each(EXPECTED_GITHUB_CHECK_IDS)("tells the reader where to verify %s on GitHub", (checkId) => {
    const hint = githubVerifyHint(checkId);
    expect(hint.startsWith("GitHub →")).toBe(true);
    expect(hint.length).toBeGreaterThan(20);
  });

  it("falls back safely for an unrecognised identifier", () => {
    expect(githubCheckGroup("provider.untrusted.raw-text").title).toBe("Other checks");
    expect(githubVerifyHint("provider.untrusted.raw-text")).toBe(
      "GitHub → the repository Settings and Security tab.",
    );
  });

  it("groups mixed checks into ordered non-empty areas", () => {
    const sections = groupChecksByArea([
      { checkId: "github.workflow.security" },
      { checkId: "github.branch.force_pushes" },
      { checkId: "provider.untrusted.raw-text" },
      { checkId: "github.secret_scanning.enabled" },
    ]);
    expect(sections.map((section) => section.group.title)).toEqual([
      "Branch protection",
      "Secret protection",
      "Workflows and access",
      "Other checks",
    ]);
    expect(sections.map((section) => section.items.map((item) => item.checkId))).toEqual([
      ["github.branch.force_pushes"],
      ["github.secret_scanning.enabled"],
      ["github.workflow.security"],
      ["provider.untrusted.raw-text"],
    ]);
  });

  it("covers every expected check in exactly one group", () => {
    const sections = groupChecksByArea(EXPECTED_GITHUB_CHECK_IDS.map((checkId) => ({ checkId })));
    expect(sections.flatMap((section) => section.items)).toHaveLength(EXPECTED_GITHUB_CHECK_IDS.length);
    expect(GITHUB_CHECK_GROUPS.map((group) => group.title)).toContain("Other checks");
  });
});
