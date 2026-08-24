import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckSeverity } from "@/features/monitoring/domain/monitor-provider";
import {
  ACTIVE_MONITORING_FINDING_STATUSES,
  type ActiveMonitoringFindingStatus,
} from "@/features/monitoring/domain/finding-status";

export type MemberMonitoringData = {
  connectedSystems: Array<{
    id: string;
    provider: string;
    label: string;
    connectedAt: string;
  }>;
  findings: Array<{
    id: string;
    controlRef: string;
    severity: CheckSeverity;
    title: string;
    detail: string;
    status: ActiveMonitoringFindingStatus;
    detectedAt: string;
  }>;
};

type SourceRow = {
  id: string;
  provider: string;
  label: string;
  connected_at: string;
};

type FindingRow = {
  id: string;
  control_ref: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
  status: ActiveMonitoringFindingStatus;
  detected_at: string;
};

export async function loadMemberMonitoring(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<MemberMonitoringData> {
  const [sourceResult, findingResult] = await Promise.all([
    supabase.rpc("list_connected_monitor_sources", {
      target_organisation_id: organisationId,
    }),
    supabase
      .from("monitoring_findings")
      .select("id,control_ref,severity,title,detail,status,detected_at")
      .eq("organisation_id", organisationId)
      .in("status", [...ACTIVE_MONITORING_FINDING_STATUSES])
      .order("detected_at", { ascending: false })
      .limit(100),
  ]);

  if (sourceResult.error || findingResult.error) {
    throw new Error("Could not load member monitoring");
  }

  return {
    connectedSystems: ((sourceResult.data ?? []) as SourceRow[]).map((source) => ({
      id: source.id,
      provider: source.provider,
      label: source.label,
      connectedAt: source.connected_at,
    })),
    findings: ((findingResult.data ?? []) as FindingRow[]).map((finding) => ({
      id: finding.id,
      controlRef: finding.control_ref,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      status: finding.status,
      detectedAt: finding.detected_at,
    })),
  };
}
