import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { deriveEvidenceStatus, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { buildReadinessReport, type ReadinessReport } from "@/features/reports/domain/readiness-report";
import { DEFAULT_RISK_MATRIX_CONFIG, calculateRiskScore, riskBand, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import type { SoaStatus } from "@/features/soa/domain/soa";
import { McpError } from "../auth/errors";
import {
  DIGEST_ATTENTION_CATEGORIES,
  DIGEST_SEVERITIES,
  type DigestAttentionCategory,
  type DigestAttentionItem,
  type DigestSeverity,
} from "../domain/digest";
import { safeSummary } from "../domain/safe-summary";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
});

export function parseLocalDate(value: string): string {
  const parsed = isoDate.safeParse(value);
  if (!parsed.success) throw new McpError("VALIDATION_ERROR");
  return parsed.data;
}

type PageResult<T> = { data: T[] | null; error: unknown };
type PageOptions = { pageSize?: number; maxRows?: number; maxPages?: number };

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: number | PageOptions = {},
): Promise<T[]> {
  const { pageSize = 500, maxRows = 10_000, maxPages = 100 } = typeof options === "number" ? { pageSize: options } : options;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError("Invalid page size");
  if (!Number.isInteger(maxRows) || maxRows < 1 || !Number.isInteger(maxPages) || maxPages < 1) throw new RangeError("Invalid pagination ceiling");
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = rows.length;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error || !Array.isArray(result.data)) throw new McpError("INTERNAL_ERROR");
    if (result.data.length === 0) return rows;
    if (rows.length + result.data.length > maxRows) throw new McpError("INTERNAL_ERROR");
    rows.push(...result.data);
  }
  throw new McpError("INTERNAL_ERROR");
}

type LiveReadinessRows = {
  soa: Array<{ status: SoaStatus }>;
  risks: Array<{ status: string; residual_likelihood: number; residual_impact: number }>;
  evidence: Array<{ status: EvidenceStatus; valid_until: string | null }>;
  tasks: { open: number; overdue: number };
  openAudits: number;
  openNonConformities: number;
  config?: RiskMatrixConfig;
  localDate: string;
};

export function buildLiveReadiness(input: LiveReadinessRows): ReadinessReport {
  const localDate = parseLocalDate(input.localDate);
  const base = buildReadinessReport({
    soa: input.soa,
    risks: input.risks
      .filter((row) => row.status !== "closed")
      .map((row) => ({ likelihood: row.residual_likelihood, impact: row.residual_impact })),
    evidence: input.evidence
      .filter((row) => row.status !== "superseded" && row.status !== "withdrawn")
      .map((row) => ({ status: deriveEvidenceStatus(row.valid_until, localDate) })),
    audits: [],
    openNonConformities: input.openNonConformities,
    tasks: input.tasks,
    config: input.config ?? DEFAULT_RISK_MATRIX_CONFIG,
  });
  return { ...base, openAudits: input.openAudits };
}

type TaskRow = { id: string; title: string; due_on: string | null; status: string };
type EvidenceRow = { id: string; title: string; valid_until: string | null; status: EvidenceStatus };
type PolicyRow = { id: string; reference: string; title: string; review_due: string | null; status: string };
type RiskRow = { id: string; reference: string; title: string; review_date: string | null; status: string; residual_likelihood: number; residual_impact: number };
type FindingRow = { id: string; audit_reference: string; severity: string; status: string; created_at: string };

export type AttentionSourceRows = {
  tasks: TaskRow[];
  evidence: EvidenceRow[];
  policies: PolicyRow[];
  risks: RiskRow[];
  findings: FindingRow[];
};

export type AttentionItem = DigestAttentionItem & { source: string; observedOn?: string };

const severityRank: Record<DigestSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const categoryRank: Record<DigestAttentionCategory, number> = {
  overdue_task: 1, stale_evidence: 2, policy_review: 3, high_risk: 4, unresolved_finding: 5,
};

function attentionOptions(options: {
  localDate: string;
  config: RiskMatrixConfig;
  categories?: readonly string[];
  severity?: string;
  limit?: number;
}) {
  const localDate = parseLocalDate(options.localDate);
  const categories = z.array(z.enum(DIGEST_ATTENTION_CATEGORIES)).max(DIGEST_ATTENTION_CATEGORIES.length)
    .safeParse(options.categories ?? DIGEST_ATTENTION_CATEGORIES);
  const severity = options.severity === undefined ? { success: true as const, data: undefined } : z.enum(DIGEST_SEVERITIES).safeParse(options.severity);
  const limit = z.number().int().min(1).max(50).safeParse(options.limit ?? 20);
  if (!categories.success || !severity.success || !limit.success) throw new McpError("VALIDATION_ERROR");
  return { localDate, categories: new Set<DigestAttentionCategory>(categories.data), severity: severity.data, limit: limit.data };
}

export function validateAttentionRequest(input: {
  localDate: string;
  categories?: readonly string[];
  severity?: string;
  limit?: number;
}): { localDate: string; categories?: readonly string[]; severity?: string; limit: number } {
  const parsed = attentionOptions({ ...input, config: DEFAULT_RISK_MATRIX_CONFIG });
  return {
    localDate: parsed.localDate,
    ...(input.categories ? { categories: input.categories } : {}),
    ...(input.severity ? { severity: input.severity } : {}),
    limit: parsed.limit,
  };
}

function item(input: Omit<AttentionItem, "summary"> & { summary: unknown }): AttentionItem {
  return { ...input, summary: safeSummary(input.summary, 240) };
}

export function buildAttentionItems(
  rows: AttentionSourceRows,
  options: { localDate: string; config: RiskMatrixConfig; categories?: readonly string[]; severity?: string; limit?: number },
): AttentionItem[] {
  const parsed = attentionOptions(options);
  const results: AttentionItem[] = [];
  if (parsed.categories.has("overdue_task")) {
    for (const row of rows.tasks) if (["open", "in_progress"].includes(row.status) && row.due_on && row.due_on < parsed.localDate) {
      results.push(item({ id: `task:${row.id}`, category: "overdue_task", severity: "high", summary: `Overdue task: ${row.title}`, dueOn: row.due_on, source: "task" }));
    }
  }
  if (parsed.categories.has("stale_evidence")) {
    for (const row of rows.evidence) {
      if (["superseded", "withdrawn"].includes(row.status) || !row.valid_until) continue;
      const status = deriveEvidenceStatus(row.valid_until, parsed.localDate);
      if (status === "expired" || status === "expiring") {
        results.push(item({ id: `evidence:${row.id}`, category: "stale_evidence", severity: status === "expired" ? "critical" : "high", summary: `${status === "expired" ? "Expired" : "Expiring"} evidence: ${row.title}`, dueOn: row.valid_until, source: "evidence" }));
      }
    }
  }
  if (parsed.categories.has("policy_review")) {
    for (const row of rows.policies) if (row.status === "approved" && row.review_due && row.review_due <= parsed.localDate) {
      results.push(item({ id: `policy:${row.id}`, category: "policy_review", severity: "high", summary: `Policy review due: ${row.reference} ${row.title}`, dueOn: row.review_due, source: "policy" }));
    }
  }
  if (parsed.categories.has("high_risk")) {
    for (const row of rows.risks) {
      if (row.status === "closed") continue;
      const band = riskBand(calculateRiskScore(row.residual_likelihood, row.residual_impact), options.config);
      if (band === "high" || band === "very_high") {
        results.push(item({ id: `risk:${row.id}`, category: "high_risk", severity: band === "very_high" ? "critical" : "high", summary: `${band === "very_high" ? "Very high" : "High"} residual risk: ${row.reference} ${row.title}`, ...(row.review_date ? { dueOn: row.review_date } : {}), source: "risk" }));
      }
    }
  }
  if (parsed.categories.has("unresolved_finding")) {
    for (const row of rows.findings) if (row.status !== "closed") {
      const severity: DigestSeverity = row.severity === "major_nc" ? "critical" : row.severity === "minor_nc" ? "high" : "medium";
      const label = row.severity === "major_nc" ? "major non-conformity" : row.severity === "minor_nc" ? "minor non-conformity" : "observation";
      results.push(item({ id: `audit_finding:${row.id}`, category: "unresolved_finding", severity, summary: `Unresolved ${label} in audit ${row.audit_reference}`, observedOn: row.created_at, source: "audit_finding" }));
    }
  }
  return results
    .filter((entry) => !parsed.severity || entry.severity === parsed.severity)
    .sort((left, right) => severityRank[right.severity] - severityRank[left.severity]
      || (left.dueOn ?? left.observedOn ?? "9999-12-31").localeCompare(right.dueOn ?? right.observedOn ?? "9999-12-31")
      || categoryRank[left.category] - categoryRank[right.category]
      || left.source.localeCompare(right.source)
      || left.id.localeCompare(right.id))
    .slice(0, parsed.limit + 1);
}

// Used by the application loaders below; exported to make the user-scoped
// transport boundary explicit without weakening it with a service-role client.
export type UserScopedSupabase = SupabaseClient;
