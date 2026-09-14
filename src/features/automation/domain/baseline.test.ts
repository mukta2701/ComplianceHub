import { describe, expect, it } from "vitest";
import { buildBaselineProposal, normaliseEvidenceSignal } from "./baseline";

describe("automation baseline mapping", () => {
  it("turns GitHub branch protection evidence into an engineering evidence draft", () => {
    const signal = normaliseEvidenceSignal({
      provider: "github",
      externalRef: "repo:acme/app:branches",
      title: "Branch protection settings",
      summary: "8 of 10 repositories protect their default branch.",
      sourceUrl: "https://github.example/acme/app/settings/branches",
      occurredAt: "2026-07-10T10:00:00Z",
    });

    expect(signal).toMatchObject({ type: "github.branch_protection", area: "engineering", confidence: "high" });
    expect(buildBaselineProposal(signal)).toEqual({
      targetType: "evidence",
      area: "engineering",
      state: "needs_review",
      title: "Review GitHub branch protection evidence",
      why: "Protected branches support controlled software changes, but a reviewer must confirm that the selected repositories are in scope.",
      recommendedAction: "Accept this source as evidence or create a remediation task for repositories that still need protection.",
    });
  });

  it("turns AWS security findings into a cloud task draft instead of a compliance decision", () => {
    const signal = normaliseEvidenceSignal({
      provider: "aws",
      externalRef: "securityhub:failed:3",
      title: "Security Hub findings",
      summary: "3 failed Security Hub controls require review.",
      occurredAt: "2026-07-10T10:00:00Z",
    });

    expect(buildBaselineProposal(signal)).toMatchObject({
      targetType: "task",
      area: "cloud",
      state: "needs_review",
    });
    expect(buildBaselineProposal(signal).recommendedAction).toMatch(/draft/i);
  });

  it("keeps unrecognised evidence as a low-confidence review item", () => {
    const signal = normaliseEvidenceSignal({
      provider: "google_workspace",
      externalRef: "unknown",
      title: "Custom administrative export",
      summary: "An administrative export was collected.",
      occurredAt: "2026-07-10T10:00:00Z",
    });

    expect(signal).toMatchObject({ type: "google_workspace.unclassified", confidence: "low", area: "identity" });
    expect(buildBaselineProposal(signal)).toMatchObject({ targetType: "evidence", state: "needs_review" });
  });
});
