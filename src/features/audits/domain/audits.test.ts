import { describe, expect, it } from "vitest";
import { AUDIT_STATUS_LABEL, CHECKLIST_RESULT_LABEL, checklistCompletion, summariseFindings } from "./audits";

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
