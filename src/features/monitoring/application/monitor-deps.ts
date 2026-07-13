import type { SupabaseClient } from "@supabase/supabase-js";
import { memoizeOwners } from "@/features/automation/application/owner-resolver";
import { decryptSecret } from "@/lib/security/secrets";
import { resolveMonitorProvider } from "./monitor-registry";
import { deliverAlert, type AlertChannel, type AlertFinding, type DeliverPorts } from "./deliver";
import { findingKey, type MonitorDependencies, type MonitorSource } from "./monitor-run";
import { createTwilioWhatsAppPort } from "./twilio-whatsapp";
import type { MonitorProviderKind, CheckSeverity } from "../domain/monitor-provider";

// A finding key is `checkId::subjectId`; both halves are opaque strings, so split
// on the first delimiter only.
function splitKey(key: string): { checkId: string; subjectId: string } {
  const at = key.indexOf("::");
  return at < 0 ? { checkId: key, subjectId: "" } : { checkId: key.slice(0, at), subjectId: key.slice(at + 2) };
}

// A critical/high failure is an active policy violation; a medium/low one is
// slower control drift. Drives the in-app notification icon + copy.
function notificationKind(severity: CheckSeverity): "policy_violation" | "control_drift" {
  return severity === "critical" || severity === "high" ? "policy_violation" : "control_drift";
}

// Build the real (Supabase + fetch) dependency port for runMonitoring. Shared by
// the hourly cron (every org) and the "Run checks now" action (one org, opts.
// organisationId). Requires a SERVICE-ROLE client: monitoring_findings and
// notifications are service-role-insert only.
export function buildMonitorDependencies(
  supabase: SupabaseClient,
  opts: { organisationId?: string } = {},
): MonitorDependencies {
  const today = new Date().toISOString().slice(0, 10);

  const resolveOwners = memoizeOwners(async (organisationId) => {
    const { data, error } = await supabase.from("memberships")
      .select("user_id").eq("organisation_id", organisationId).eq("role", "owner");
    if (error) throw error;
    return (data ?? []).map((row) => row.user_id as string);
  });

  const ports: DeliverPorts = {
    postSlack: async (webhookUrl, payload) => {
      const res = await fetch(webhookUrl, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
    },
    postWhatsApp: createTwilioWhatsAppPort(),
    notifyInApp: async (finding: AlertFinding) => {
      const owners = await resolveOwners(finding.organisationId);
      for (const userId of owners) {
        const { error } = await supabase.from("notifications").upsert({
          organisation_id: finding.organisationId, user_id: userId, kind: notificationKind(finding.severity),
          subject_type: "monitoring_finding", subject_id: findingKey(finding.checkId, finding.subjectId),
          message: finding.title.slice(0, 500), sweep_on: today,
        }, { onConflict: "user_id,kind,subject_type,subject_id,sweep_on", ignoreDuplicates: true });
        if (error) throw error;
      }
    },
  };

  return {
    listActiveSources: async () => {
      let query = supabase.from("monitor_sources")
        .select("id,organisation_id,provider,config,access_token").is("revoked_at", null);
      if (opts.organisationId) query = query.eq("organisation_id", opts.organisationId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row): MonitorSource => ({
        id: row.id, organisationId: row.organisation_id, provider: row.provider as MonitorProviderKind,
        config: (row.config ?? {}) as Record<string, unknown>, accessToken: decryptSecret(row.access_token) ?? "",
      }));
    },
    runChecks: (source) => resolveMonitorProvider(source.provider).runChecks({
      id: source.id, provider: source.provider, config: source.config, accessToken: source.accessToken,
    }),
    listOpenFindingKeys: async (organisationId) => {
      const { data, error } = await supabase.from("monitoring_findings")
        .select("check_id,subject_id").eq("organisation_id", organisationId).in("status", ["open", "acknowledged"]);
      if (error) throw error;
      return (data ?? []).map((row) => findingKey(row.check_id as string, row.subject_id as string));
    },
    saveFinding: async (finding) => {
      // Upsert on the (organisation_id, check_id, subject_id) dedup key: inserts a
      // new open finding, or re-opens (fresh detected_at, cleared resolved_at) one
      // that had resolved. Acknowledged findings are filtered out upstream, so this
      // never clobbers an acknowledgement.
      const { error } = await supabase.from("monitoring_findings").upsert({
        organisation_id: finding.organisationId, source_id: finding.sourceId,
        check_id: finding.checkId, control_ref: finding.controlRef,
        subject_type: finding.subjectType, subject_id: finding.subjectId,
        severity: finding.severity, title: finding.title, detail: finding.detail,
        status: "open", detected_at: new Date().toISOString(), resolved_at: null,
      }, { onConflict: "organisation_id,check_id,subject_id" });
      if (error) throw error;
    },
    resolveFindings: async (organisationId, keys) => {
      let resolved = 0;
      for (const key of keys) {
        const { checkId, subjectId } = splitKey(key);
        const { data, error } = await supabase.from("monitoring_findings")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("organisation_id", organisationId).eq("check_id", checkId).eq("subject_id", subjectId)
          .in("status", ["open", "acknowledged"]).select("id");
        if (error) throw error;
        resolved += data?.length ?? 0;
      }
      return resolved;
    },
    listExternalChannels: async (organisationId) => {
      const { data, error } = await supabase.from("alert_channels")
        .select("id,type,config,min_severity")
        .eq("organisation_id", organisationId).is("revoked_at", null).in("type", ["slack", "whatsapp"]);
      if (error) throw error;
      return (data ?? []).map((row): AlertChannel => {
        // The webhook is stored encrypted; decrypt it so the delivery adapter can POST.
        const rawConfig = (row.config ?? {}) as Record<string, unknown>;
        const config = typeof rawConfig.webhookUrl === "string"
          ? { ...rawConfig, webhookUrl: decryptSecret(rawConfig.webhookUrl) ?? "" }
          : rawConfig;
        return { id: row.id, type: row.type, config, minSeverity: row.min_severity as CheckSeverity };
      });
    },
    deliver: (channel, finding) => deliverAlert(channel, finding, ports),
    notifyInApp: ports.notifyInApp,
  };
}
