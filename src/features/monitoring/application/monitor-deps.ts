import type { SupabaseClient } from "@supabase/supabase-js";
import { memoizeOwners } from "@/features/automation/application/owner-resolver";
import { decryptSecret } from "@/lib/security/secrets";
import { postSlackIncomingWebhook } from "@/lib/integrations/slack-incoming-webhook";
import {
  approveSlackDestination,
  approveStoredSlackDestination,
} from "@/features/mcp/application/slack-destination-policy";
import { resolveMonitorProvider } from "./monitor-registry";
import { deliverAlert, type AlertChannel, type AlertFinding, type DeliverPorts } from "./deliver";
import { findingKey, type MonitorDependencies, type MonitorSource } from "./monitor-run";
import { createTwilioWhatsAppPort } from "./twilio-whatsapp";
import type { MonitorProviderKind, CheckSeverity } from "../domain/monitor-provider";
import { ACTIVE_MONITORING_FINDING_STATUSES } from "../domain/finding-status";
import { collectIdPages, collectStringCursorPages } from "@/lib/supabase/paginate";

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

export async function postMonitoringSlackWebhook(webhookUrl: string, payload: unknown): Promise<void> {
  const approved = approveSlackDestination(webhookUrl);
  if (approved.status !== "approved") throw new Error("Slack destination is not approved");
  const result = await postSlackIncomingWebhook(approved.canonicalUrl, payload);
  if (result.kind !== "response" || result.status < 200 || result.status >= 300) {
    throw new Error("Slack webhook delivery failed");
  }
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

  const resolveOperators = memoizeOwners(async (organisationId) => {
    const rows = await collectStringCursorPages(async (afterUserId, limit) => {
      let query = supabase.from("memberships")
        .select("user_id")
        .eq("organisation_id", organisationId)
        .in("role", ["owner", "admin"])
        .order("user_id", { ascending: true })
        .limit(limit);
      if (afterUserId) query = query.gt("user_id", afterUserId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    }, (row) => row.user_id as string);
    return rows.map((row) => row.user_id as string);
  });

  const ports: DeliverPorts = {
    postSlack: postMonitoringSlackWebhook,
    postWhatsApp: createTwilioWhatsAppPort(),
    notifyInApp: async (finding: AlertFinding) => {
      const operators = await resolveOperators(finding.organisationId);
      for (const userId of operators) {
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
      const rows = await collectIdPages(async (afterId, limit) => {
        let query = supabase.from("monitor_sources")
          .select("id,organisation_id,provider,config,access_token,connection_mode,integration_connection_id,broker_connection_id,broker_provider_config_key,integration_connection:integration_connections(id,organisation_id,provider,connection_mode,config,enabled,revoked_at,broker_connection_id,broker_provider_config_key)")
          .is("revoked_at", null).eq("enabled", true)
          .order("id", { ascending: true })
          .limit(limit);
        if (opts.organisationId) query = query.eq("organisation_id", opts.organisationId);
        if (afterId) query = query.gt("id", afterId);
        const { data, error } = await query;
        if (error) throw error;
        return data ?? [];
      });
      return rows.flatMap((row): MonitorSource[] => {
        if (row.connection_mode === "sandbox" && row.integration_connection_id === null) {
          return [{
            id: row.id, organisationId: row.organisation_id, provider: row.provider as MonitorProviderKind,
            config: (row.config ?? {}) as Record<string, unknown>, accessToken: decryptSecret(row.access_token) ?? "",
            connectionMode: "sandbox", brokerConnectionId: null, brokerProviderConfigKey: null,
          }];
        }
        const parentJoin = row.integration_connection;
        const parent = Array.isArray(parentJoin)
          ? (parentJoin.length === 1 ? parentJoin[0] : null)
          : parentJoin;
        if (
          row.connection_mode !== "oauth"
          || !parent
          || parent.id !== row.integration_connection_id
          || parent.organisation_id !== row.organisation_id
          || parent.provider !== "github"
          || parent.connection_mode !== "oauth"
          || parent.enabled !== true
          || parent.revoked_at !== null
          || typeof parent.broker_connection_id !== "string"
          || typeof parent.broker_provider_config_key !== "string"
        ) return [];
        return [{
          id: row.id, organisationId: parent.organisation_id, provider: parent.provider as MonitorProviderKind,
          config: (parent.config ?? {}) as Record<string, unknown>, accessToken: "", connectionMode: "oauth",
          brokerConnectionId: parent.broker_connection_id,
          brokerProviderConfigKey: parent.broker_provider_config_key,
        }];
      });
    },
    runChecks: (source) => resolveMonitorProvider(source).runChecks(source),
    listOpenFindingKeys: async (organisationId) => {
      const rows = await collectIdPages(async (afterId, limit) => {
        let query = supabase.from("monitoring_findings")
          .select("id,check_id,subject_id")
          .eq("organisation_id", organisationId)
          .eq("finding_origin", "legacy")
          .in("status", [...ACTIVE_MONITORING_FINDING_STATUSES])
          .order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        const { data, error } = await query;
        if (error) throw error;
        return data ?? [];
      });
      return rows.map((row) => findingKey(row.check_id as string, row.subject_id as string));
    },
    saveFinding: async (finding) => {
      // Upsert on the origin-aware stable identity: inserts a
      // new open finding, or re-opens (fresh detected_at, cleared resolved_at) one
      // that had resolved. Acknowledged findings are filtered out upstream, so this
      // never clobbers an acknowledgement.
      const { error } = await supabase.from("monitoring_findings").upsert({
        organisation_id: finding.organisationId, source_id: finding.sourceId,
        check_id: finding.checkId, control_ref: finding.controlRef,
        subject_type: finding.subjectType, subject_id: finding.subjectId,
        severity: finding.severity, title: finding.title, detail: finding.detail,
        finding_origin: "legacy", mapping_version: "legacy",
        status: "open", detected_at: new Date().toISOString(), resolved_at: null,
      }, { onConflict: "organisation_id,finding_origin,stable_subject_identity,check_id" });
      if (error) throw error;
    },
    resolveFindings: async (organisationId, keys) => {
      let resolved = 0;
      for (const key of keys) {
        const { checkId, subjectId } = splitKey(key);
        const { data, error } = await supabase.from("monitoring_findings")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("organisation_id", organisationId).eq("check_id", checkId).eq("subject_id", subjectId)
          .eq("finding_origin", "legacy")
          .in("status", [...ACTIVE_MONITORING_FINDING_STATUSES]).select("id");
        if (error) throw error;
        resolved += data?.length ?? 0;
      }
      return resolved;
    },
    listExternalChannels: async (organisationId) => {
      const rows = await collectIdPages(async (afterId, limit) => {
        let query = supabase.from("alert_channels")
          .select("id,type,config,min_severity")
          .eq("organisation_id", organisationId)
          .is("revoked_at", null)
          .eq("enabled", true)
          .in("type", ["slack", "whatsapp"])
          .order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        const { data, error } = await query;
        if (error) throw error;
        return data ?? [];
      });
      return rows.map((row): AlertChannel => {
        const rawConfig = (row.config ?? {}) as Record<string, unknown>;
        if (row.type !== "slack") {
          return { id: row.id, type: row.type, config: rawConfig, minSeverity: row.min_severity as CheckSeverity };
        }

        // Fail closed before decrypting legacy/malformed/mismatched rows. The
        // marker keeps this channel in the result so one rejected destination
        // becomes an isolated generic failure rather than starving other work.
        const stored = approveStoredSlackDestination(rawConfig);
        if (stored.status !== "approved") {
          return {
            id: row.id,
            type: row.type,
            config: { slackDestinationStatus: "not_approved" },
            minSeverity: row.min_severity as CheckSeverity,
          };
        }
        try {
          const decrypted = decryptSecret(stored.encryptedWebhook);
          const approved = decrypted ? approveSlackDestination(decrypted) : { status: "not_approved" as const };
          if (approved.status !== "approved") throw new Error("not approved");
          return {
            id: row.id,
            type: row.type,
            config: { webhookUrl: approved.canonicalUrl },
            minSeverity: row.min_severity as CheckSeverity,
          };
        } catch {
          return {
            id: row.id,
            type: row.type,
            config: { slackDestinationStatus: "not_approved" },
            minSeverity: row.min_severity as CheckSeverity,
          };
        }
      });
    },
    deliver: (channel, finding) => deliverAlert(channel, finding, ports),
    notifyInApp: ports.notifyInApp,
  };
}
