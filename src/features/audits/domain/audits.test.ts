import { describe, expect, it } from "vitest";
import { AUDIT_STATUS_LABEL, CHECKLIST_RESULT_LABEL, checklistCompletion, recentAuditorViews, summariseFindings } from "./audits";

describe("audit labels", () => {
  it("labels statuses and results in en-GB", () => {
    expect(AUDIT_STATUS_LABEL.in_progress).toBe("In progress");
    expect(CHECKLIST_RESULT_LABEL.non_compliant).toBe("Non-compliant");
    expect(CHECKLIST_RESULT_LABEL.not_tested).toBe("Not tested");
  });
});

describe("checklistCompletion", () => {
  it("counts anything other than not_tested as tested", () => {
    expect(checklistCompletion([])).toEqual({ tested: 0, total: 0, percent: 0 });
    expect(checklistCompletion([
      { compliant: "compliant" }, { compliant: "non_compliant" }, { compliant: "not_tested" }, { compliant: "not_applicable" },
    ])).toEqual({ tested: 3, total: 4, percent: 75 });
  });
});

describe("summariseFindings", () => {
  it("counts by severity and reports open non-conformities", () => {
    expect(summariseFindings([
      { severity: "major_nc", status: "open" },
      { severity: "minor_nc", status: "closed" },
      { severity: "observation", status: "open" },
      { severity: "major_nc", status: "in_progress" },
    ])).toEqual({ total: 4, open: 3, majorNc: 2, minorNc: 1, observations: 1, openNonConformities: 2 });
  });
});

describe("recentAuditorViews", () => {
  it("returns at most ten safe label and timestamp fields", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      viewed_at: `2026-07-13T01:${String(index).padStart(2, "0")}:00.000Z`,
      token_id: `secret-token-id-${index}`,
      auditor_access_tokens: { label: index === 0 ? "" : `Auditor ${index}`, token_hash: `secret-hash-${index}` },
    }));

    const result = recentAuditorViews(rows);

    expect(result).toHaveLength(10);
    expect(result[0]).toEqual({ label: "Auditor link", viewedAt: "2026-07-13T01:00:00.000Z" });
    expect(result[1]).toEqual({ label: "Auditor 1", viewedAt: "2026-07-13T01:01:00.000Z" });
    expect(result[0]).not.toHaveProperty("token_id");
    expect(result[0]).not.toHaveProperty("token_hash");
  });
});
