import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadinessReportInput } from "@/features/reports/domain/readiness-report";
import type { SoaStatus } from "@/features/soa/domain/soa";
import type { EvidenceStatus } from "@/features/evidence/domain/evidence";
import { DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";

// Loads the RLS-scoped raw arrays the readiness report aggregates. Explicit
// organisation filters keep multi-workspace users inside the active workspace;
// RLS remains the underlying tenant-isolation boundary.
export async function loadReadinessInput(supabase: SupabaseClient, organisationId: string): Promise<ReadinessReportInput> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: register } = await supabase.from("soa_registers").select("id").eq("organisation_id", organisationId).order("version", { ascending: false }).limit(1).maybeSingle();
  const [soa, risks, evidence, audits, findings, openTasks, overdueTasks, cfg] = await Promise.all([
    register ? supabase.from("soa_items").select("status").eq("organisation_id", organisationId).eq("soa_register_id", register.id) : Promise.resolve({ data: [] as { status: string }[] }),
    supabase.from("risks").select("likelihood,impact").eq("organisation_id", organisationId),
    supabase.from("evidence").select("status").eq("organisation_id", organisationId),
    supabase.from("audits").select("status").eq("organisation_id", organisationId),
    supabase.from("audit_findings").select("id").eq("organisation_id", organisationId).neq("status", "closed").neq("severity", "observation"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).in("status", ["open", "in_progress"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").eq("organisation_id", organisationId).maybeSingle(),
  ]);
  const config: RiskMatrixConfig = cfg.data
    ? { lowMax: cfg.data.low_max, moderateMax: cfg.data.moderate_max, highMax: cfg.data.high_max, appetite: cfg.data.appetite_threshold }
    : DEFAULT_RISK_MATRIX_CONFIG;
  return {
    soa: (soa.data ?? []).map((s) => ({ status: s.status as SoaStatus })),
    risks: (risks.data ?? []).map((r) => ({ likelihood: r.likelihood, impact: r.impact })),
    evidence: (evidence.data ?? []).map((e) => ({ status: e.status as EvidenceStatus })),
    audits: (audits.data ?? []).map((a) => ({ status: a.status as string })),
    openNonConformities: (findings.data ?? []).length,
    tasks: { open: openTasks.count ?? 0, overdue: overdueTasks.count ?? 0 },
    config,
  };
}
