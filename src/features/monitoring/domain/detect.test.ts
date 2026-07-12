import { describe, expect, it } from "vitest";
import { findingKey, planFindings, planResolutions, summariseChecks } from "./detect";
import type { CheckResult } from "./monitor-provider";

function check(over: Partial<CheckResult> & { checkId: string; passed: boolean }): CheckResult {
  return {
    controlRef: "A.8.32", subjectType: "github_repo", subjectId: "acme/isms",
    severity: "high", title: "t", detail: "d", ...over,
  };
}

describe("planFindings", () => {
  it("raises a finding only for failing checks with no open finding", () => {
    const checks = [check({ checkId: "a", passed: false }), check({ checkId: "b", passed: true })];
    const found = planFindings(checks, []);
    expect(found.map((f) => f.checkId)).toEqual(["a"]);
    expect(found[0]).toMatchObject({ controlRef: "A.8.32", subjectId: "acme/isms", severity: "high" });
  });

  it("does not duplicate a finding that is already open", () => {
    const checks = [check({ checkId: "a", passed: false })];
    expect(planFindings(checks, [findingKey("a", "acme/isms")])).toEqual([]);
  });

  it("keys by check + subject, so the same check on a different subject is a new finding", () => {
    const checks = [check({ checkId: "a", passed: false, subjectId: "acme/other" })];
    expect(planFindings(checks, [findingKey("a", "acme/isms")]).map((f) => f.subjectId)).toEqual(["acme/other"]);
  });
});

describe("planResolutions", () => {
  it("resolves open findings whose check now passes", () => {
    const checks = [check({ checkId: "a", passed: true })];
    expect(planResolutions(checks, [findingKey("a", "acme/isms"), findingKey("b", "acme/isms")])).toEqual([findingKey("a", "acme/isms")]);
  });
});

describe("summariseChecks", () => {
  it("counts pass/fail and reports the worst failing severity", () => {
    const checks = [
      check({ checkId: "a", passed: false, severity: "medium" }),
      check({ checkId: "b", passed: false, severity: "critical" }),
      check({ checkId: "c", passed: true }),
    ];
    expect(summariseChecks(checks)).toEqual({ total: 3, passing: 1, failing: 2, worstSeverity: "critical" });
  });

  it("reports null worst severity when everything passes", () => {
    expect(summariseChecks([check({ checkId: "a", passed: true })]).worstSeverity).toBeNull();
  });
});
