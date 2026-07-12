import type { CheckResult, CheckSeverity } from "./monitor-provider";

// A finding is keyed by (checkId, subjectId) so re-running the same check on the
// same subject never duplicates, and a check that flips back to passing resolves
// the open finding it raised.
export function findingKey(checkId: string, subjectId: string): string {
  return `${checkId}::${subjectId}`;
}

export type NewFinding = {
  checkId: string;
  controlRef: string;
  subjectType: string;
  subjectId: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
};

// Failed checks that don't already have an open finding become new findings.
export function planFindings(checks: readonly CheckResult[], openFindingKeys: readonly string[]): NewFinding[] {
  const open = new Set(openFindingKeys);
  return checks
    .filter((check) => !check.passed && !open.has(findingKey(check.checkId, check.subjectId)))
    .map((check) => ({
      checkId: check.checkId,
      controlRef: check.controlRef,
      subjectType: check.subjectType,
      subjectId: check.subjectId,
      severity: check.severity,
      title: check.title,
      detail: check.detail,
    }));
}

// Open findings whose underlying check now passes should auto-resolve — monitoring
// closes the loop without the user having to.
export function planResolutions(checks: readonly CheckResult[], openFindingKeys: readonly string[]): string[] {
  const passing = new Set(checks.filter((c) => c.passed).map((c) => findingKey(c.checkId, c.subjectId)));
  return openFindingKeys.filter((key) => passing.has(key));
}

const SEVERITY_RANK: Record<CheckSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function summariseChecks(checks: readonly CheckResult[]): {
  total: number;
  passing: number;
  failing: number;
  worstSeverity: CheckSeverity | null;
} {
  let passing = 0;
  let worst: CheckSeverity | null = null;
  for (const check of checks) {
    if (check.passed) { passing += 1; continue; }
    if (worst === null || SEVERITY_RANK[check.severity] > SEVERITY_RANK[worst]) worst = check.severity;
  }
  return { total: checks.length, passing, failing: checks.length - passing, worstSeverity: worst };
}
