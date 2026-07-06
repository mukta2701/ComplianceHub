import { describe, expect, it } from "vitest";
import { POLICY_STATUS_LABEL, isMaterialPolicyEdit, normalisePolicyBody, summarisePolicyAcceptances } from "./policies";

describe("policy status labels", () => {
  it("labels every status in en-GB", () => {
    expect(POLICY_STATUS_LABEL.in_review).toBe("In review");
    expect(POLICY_STATUS_LABEL.approved).toBe("Approved");
    expect(POLICY_STATUS_LABEL.archived).toBe("Archived");
  });
});

describe("normalisePolicyBody", () => {
  it("collapses whitespace and trims the ends", () => {
    expect(normalisePolicyBody("  We   protect data.\n")).toBe("We protect data.");
  });
});

describe("isMaterialPolicyEdit", () => {
  it("treats whitespace-only differences as non-material and text changes as material", () => {
    expect(isMaterialPolicyEdit("We protect data.", "We protect data.")).toBe(false);
    expect(isMaterialPolicyEdit("We protect data.", "  We   protect data.\n")).toBe(false);
    expect(isMaterialPolicyEdit("We protect data.", "We protect all data.")).toBe(true);
  });
});

describe("summarisePolicyAcceptances", () => {
  it("counts acceptances at the current version against the member roster", () => {
    expect(summarisePolicyAcceptances(2, [], 4)).toEqual({ acceptedCurrent: 0, total: 4, percent: 0, outstanding: 4 });
    expect(summarisePolicyAcceptances(2, [
      { accepted_version: 2 }, { accepted_version: 1 }, { accepted_version: 2 },
    ], 4)).toEqual({ acceptedCurrent: 2, total: 4, percent: 50, outstanding: 2 });
    expect(summarisePolicyAcceptances(1, [], 0)).toEqual({ acceptedCurrent: 0, total: 0, percent: 0, outstanding: 0 });
  });
});
