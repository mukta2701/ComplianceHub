import { summariseSoaReadiness } from "@/features/soa/domain/readiness";
import type { SoaStatus } from "@/features/soa/domain/soa";
import { calculateRiskScore, riskBand, DEFAULT_RISK_MATRIX_CONFIG, type RiskBand, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";

export type ReadinessReportInput = {
  soa: readonly { status: SoaStatus }[];
  risks: readonly { likelihood: number; impact: number }[];
  tasks: { open: number; overdue: number };
  evidence: readonly { status: EvidenceStatus }[];
  audits: readonly { status: string }[];
  openNonConformities: number;
  config?: RiskMatrixConfig;
};

export type ReadinessReport = {
  soaPercent: number;
  soaTotal: number;
  riskBands: Record<RiskBand, number>;
  tasksOpen: number;
  tasksOverdue: number;
  evidence: { total: number; expiring: number; expired: number };
  openAudits: number;
  openNonConformities: number;
};

// Pure aggregation: folds the existing SoA/risk/evidence/audit domain summaries
// into a single leadership view. No IO — the caller supplies RLS-scoped arrays.
export function buildReadinessReport(input: ReadinessReportInput): ReadinessReport {
  const soa = summariseSoaReadiness(input.soa);
  const config = input.config ?? DEFAULT_RISK_MATRIX_CONFIG;
  const riskBands: Record<RiskBand, number> = { low: 0, moderate: 0, high: 0, very_high: 0 };
  for (const r of input.risks) riskBands[riskBand(calculateRiskScore(r.likelihood, r.impact), config)] += 1;
  return {
    soaPercent: soa.percent,
    soaTotal: soa.total,
    riskBands,
    tasksOpen: input.tasks.open,
    tasksOverdue: input.tasks.overdue,
    evidence: summariseEvidenceFreshness(input.evidence),
    openAudits: input.audits.filter((a) => a.status !== "closed").length,
    openNonConformities: input.openNonConformities,
  };
}
