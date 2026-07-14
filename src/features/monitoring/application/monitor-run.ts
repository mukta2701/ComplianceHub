import type { CheckResult, MonitorProviderKind } from "../domain/monitor-provider";
import { findingKey, planFindings, planResolutions } from "../domain/detect";
import type { AlertChannel, AlertFinding, DeliveryResult } from "./deliver";

// The monitoring run: for every watched source, run its compliance checks, diff
// the failures against the findings already open, persist the new ones, always
// raise an in-app alert (the pop-up), fan out to the external channels, then
// auto-resolve any open finding whose check now passes. Mirrors runDailySweep —
// pure domain planners (detect.ts) behind an injected persistence/delivery port,
// so it's unit-testable with no DB and no network.

export type MonitorSource = {
  id: string;
  organisationId: string;
  provider: MonitorProviderKind;
  config: Record<string, unknown>;
  accessToken: string;
  connectionMode: "sandbox" | "oauth";
  brokerConnectionId: string | null;
  brokerProviderConfigKey: string | null;
};

export type SaveFindingInput = {
  organisationId: string;
  sourceId: string | null;
  checkId: string;
  controlRef: string;
  subjectType: string;
  subjectId: string;
  severity: AlertFinding["severity"];
  title: string;
  detail: string;
};

export type MonitorSummary = {
  sourcesChecked: number;
  findingsRaised: number;
  findingsResolved: number;
  alertsDelivered: number;
  alertsFailed: number;
  sourcesFailed: number;
};

export type MonitorDependencies = {
  listActiveSources: () => Promise<MonitorSource[]>;
  runChecks: (source: MonitorSource) => Promise<CheckResult[]>;
  // Keys (findingKey) of this org's findings that are open or acknowledged — i.e.
  // not resolved. planFindings skips these so an already-raised finding never
  // re-alerts, and an acknowledged one stays quiet until it resolves.
  listOpenFindingKeys: (organisationId: string) => Promise<string[]>;
  // Upsert on the (organisation_id, check_id, subject_id) dedup key: insert a new
  // open finding, or re-open one that had resolved. Idempotent.
  saveFinding: (finding: SaveFindingInput) => Promise<void>;
  resolveFindings: (organisationId: string, keys: string[]) => Promise<number>;
  // External channels only (slack / whatsapp). In-app is always-on below.
  listExternalChannels: (organisationId: string) => Promise<AlertChannel[]>;
  deliver: (channel: AlertChannel, finding: AlertFinding) => Promise<DeliveryResult>;
  // The always-on in-app pop-up: notify the responsible people in the web app.
  notifyInApp: (finding: AlertFinding) => Promise<void>;
};

function toAlertFinding(source: MonitorSource, finding: SaveFindingInput): AlertFinding {
  return {
    organisationId: finding.organisationId,
    sourceId: finding.sourceId,
    checkId: finding.checkId,
    controlRef: finding.controlRef,
    subjectType: finding.subjectType,
    subjectId: finding.subjectId,
    severity: finding.severity,
    title: finding.title,
    detail: finding.detail,
  };
}

export async function runMonitoring(deps: MonitorDependencies): Promise<MonitorSummary> {
  const summary: MonitorSummary = {
    sourcesChecked: 0, findingsRaised: 0, findingsResolved: 0,
    alertsDelivered: 0, alertsFailed: 0, sourcesFailed: 0,
  };
  const sources = await deps.listActiveSources();

  for (const source of sources) {
    // One source (or one org's mis-config) must not starve the rest of the run —
    // isolate each source, count failures, and keep going (mirrors collectEvidence).
    try {
      const checks = await deps.runChecks(source);
      const openKeys = await deps.listOpenFindingKeys(source.organisationId);

      for (const planned of planFindings(checks, openKeys)) {
        const finding: SaveFindingInput = {
          organisationId: source.organisationId, sourceId: source.id,
          checkId: planned.checkId, controlRef: planned.controlRef,
          subjectType: planned.subjectType, subjectId: planned.subjectId,
          severity: planned.severity, title: planned.title, detail: planned.detail,
        };
        await deps.saveFinding(finding);
        summary.findingsRaised += 1;

        const alert = toAlertFinding(source, finding);
        // Always raise the in-app pop-up for the app's users…
        await deps.notifyInApp(alert);
        // …then fan out to every external channel (Slack now, WhatsApp Phase 2).
        for (const channel of await deps.listExternalChannels(source.organisationId)) {
          const result = await deps.deliver(channel, alert);
          if (result.status === "delivered") summary.alertsDelivered += 1;
          else if (result.status === "failed") summary.alertsFailed += 1;
        }
      }

      // Close the loop: any open finding whose check now passes auto-resolves.
      const resolvableKeys = planResolutions(checks, openKeys);
      if (resolvableKeys.length > 0) {
        summary.findingsResolved += await deps.resolveFindings(source.organisationId, resolvableKeys);
      }
      summary.sourcesChecked += 1;
    } catch {
      summary.sourcesFailed += 1;
    }
  }
  return summary;
}

// Re-exported so the cron can build the same key the DB dedup constraint enforces.
export { findingKey };
