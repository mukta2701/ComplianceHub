import type { SoaStatus } from "./soa";

// Maturity weight for readiness reporting. Original weighting (NOT the toolkit's
// decorative Metrices percentages). not_applicable is excluded from the base.
const WEIGHTS: Record<Exclude<SoaStatus, "not_applicable">, number> = {
  pending: 0, absent: 0, in_progress: 0.4, established: 0.7, operational: 0.9, advanced: 1,
};

export function soaReadinessWeight(status: SoaStatus): number | null {
  return status === "not_applicable" ? null : WEIGHTS[status];
}

export function summariseSoaReadiness(items: readonly { status: SoaStatus }[]): { weightedComplete: number; total: number; percent: number } {
  const applicable = items.filter((i) => i.status !== "not_applicable");
  const total = applicable.length;
  const weightedComplete = applicable.reduce((sum, i) => sum + (soaReadinessWeight(i.status) ?? 0), 0);
  const percent = total === 0 ? 0 : Math.round((weightedComplete / total) * 100);
  return { weightedComplete, total, percent };
}
