import type { SupabaseClient } from "@supabase/supabase-js";

type ConnectedSystemRow = {
  id: string;
  provider: string;
  label: string;
  connected_at: string;
};

type FindingRow = {
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged";
};

export type MemberOverviewData = {
  organisationName: string;
  jobTitle: string | null;
  policies: {
    approved: number;
    acceptedCurrent: number;
  };
  connectedSystems: Array<{
    id: string;
    provider: string;
    label: string;
    connectedAt: string;
  }>;
  findings: {
    active: number;
    highOrCritical: number;
  };
};

export async function loadMemberOverview(
  supabase: SupabaseClient,
  context: { organisationId: string; organisationName: string; jobTitle: string | null },
): Promise<MemberOverviewData> {
  const [policyResult, acceptanceResult, sourceResult, findingResult] = await Promise.all([
    supabase
      .from("policies")
      .select("id,version")
      .eq("organisation_id", context.organisationId)
      .eq("status", "approved"),
    supabase
      .from("policy_acceptances")
      .select("policy_id,accepted_version")
      .eq("organisation_id", context.organisationId),
    supabase.rpc("list_connected_monitor_sources", {
      target_organisation_id: context.organisationId,
    }),
    supabase
      .from("monitoring_findings")
      .select("severity,status")
      .eq("organisation_id", context.organisationId)
      .in("status", ["open", "acknowledged"]),
  ]);

  if (policyResult.error || acceptanceResult.error || sourceResult.error || findingResult.error) {
    throw new Error("Could not load the member overview");
  }

  const policies = policyResult.data ?? [];
  const acceptedVersion = new Map(
    (acceptanceResult.data ?? []).map((row) => [row.policy_id, row.accepted_version]),
  );
  const findings = (findingResult.data ?? []) as FindingRow[];

  return {
    organisationName: context.organisationName,
    jobTitle: context.jobTitle,
    policies: {
      approved: policies.length,
      acceptedCurrent: policies.filter((policy) => acceptedVersion.get(policy.id) === policy.version).length,
    },
    connectedSystems: ((sourceResult.data ?? []) as ConnectedSystemRow[]).map((source) => ({
      id: source.id,
      provider: source.provider,
      label: source.label,
      connectedAt: source.connected_at,
    })),
    findings: {
      active: findings.length,
      highOrCritical: findings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length,
    },
  };
}
