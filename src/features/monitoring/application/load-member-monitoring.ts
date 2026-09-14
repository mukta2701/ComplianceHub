import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CheckSeverity } from "@/features/monitoring/domain/monitor-provider";
import {
  ACTIVE_MONITORING_FINDING_STATUSES,
  type ActiveMonitoringFindingStatus,
} from "@/features/monitoring/domain/finding-status";
import {
  loadOfficialGitHubFindingProvenance,
  type OfficialGitHubFindingProvenance,
} from "@/features/github/application/github-record-provenance";

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
    origin: "legacy" | "github";
    status: ActiveMonitoringFindingStatus;
    detectedAt: string;
  }>;
  officialGitHubFindings: OfficialGitHubFindingProvenance[];
};

const sourceRowsSchema = z.array(z.object({
  id: z.uuid(),
  provider: z.literal("github"),
  label: z.string().min(1).max(160),
  connected_at: z.string().datetime({ offset: true }),
}).strict()).max(100);

const findingRowsSchema = z.array(z.object({
  id: z.uuid(),
  control_ref: z.string().min(1).max(40),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1).max(300),
  detail: z.string().max(4_000),
  finding_origin: z.enum(["legacy", "github"]),
  status: z.enum(ACTIVE_MONITORING_FINDING_STATUSES),
  detected_at: z.string().datetime({ offset: true }),
}).strict()).max(100);

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
      .select("id,control_ref,severity,title,detail,status,detected_at,finding_origin")
      .eq("organisation_id", organisationId)
      .in("status", [...ACTIVE_MONITORING_FINDING_STATUSES])
      .order("detected_at", { ascending: false })
      .limit(100),
  ]);

  if (sourceResult.error || findingResult.error) {
    throw new Error("Could not load member monitoring");
  }

  const sourcesResult = sourceRowsSchema.safeParse(sourceResult.data ?? []);
  const findingsResult = findingRowsSchema.safeParse(findingResult.data ?? []);
  if (!sourcesResult.success || !findingsResult.success) {
    throw new Error("Could not load member monitoring");
  }

  const findings = findingsResult.data.map((finding) => ({
    id: finding.id,
    controlRef: finding.control_ref,
    severity: finding.severity,
    title: finding.title,
    detail: finding.detail,
    origin: finding.finding_origin,
    status: finding.status,
    detectedAt: finding.detected_at,
  }));
  const githubTargets = findings
    .filter((finding) => finding.origin === "github")
    .map((finding) => ({ findingId: finding.id, status: finding.status }));
  const officialGitHubFindings = await loadOfficialGitHubFindingProvenance(
    supabase,
    organisationId,
    githubTargets,
  );
  if (officialGitHubFindings.length !== githubTargets.length
    || officialGitHubFindings.some((record) => !githubTargets.some((target) => target.findingId === record.findingId))) {
    throw new Error("Could not load member monitoring");
  }

  return {
    connectedSystems: sourcesResult.data.map((source) => ({
      id: source.id,
      provider: source.provider,
      label: source.label,
      connectedAt: source.connected_at,
    })),
    findings,
    officialGitHubFindings,
  };
}
