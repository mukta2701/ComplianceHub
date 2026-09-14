import { describe, expect, it } from "vitest";
import { assessAuditPreflight } from "./preflight";

describe("assessAuditPreflight", () => {
  it("reports deterministic blockers without making compliance decisions", () => {
    expect(assessAuditPreflight({ pendingControls: 3, ownerGaps: 1, expiredEvidence: 2, overdueTasks: 4, openFindings: 1 })).toEqual([
      "3 applicable SoA controls still need review.",
      "1 applicable SoA control has no owner.",
      "2 evidence records are expired.",
      "4 remediation tasks are overdue.",
      "1 audit finding remains open.",
    ]);
  });

  it("reports ready-for-human-review when there are no blockers", () => {
    expect(assessAuditPreflight({ pendingControls: 0, ownerGaps: 0, expiredEvidence: 0, overdueTasks: 0, openFindings: 0 })).toEqual([]);
  });

  it("includes an incomplete organisation boundary in preflight", () => {
    expect(assessAuditPreflight({ pendingControls: 0, ownerGaps: 0, expiredEvidence: 0, overdueTasks: 0, openFindings: 0, scopeGaps: 2 })).toEqual(["2 organisation scope decisions are incomplete."]);
  });
});
