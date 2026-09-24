import { createHash } from "node:crypto";
import { EXPECTED_GITHUB_CHECK_IDS, type ExpectedGitHubCheckId } from "@/features/github/domain/rules";
import type { ObservationResult } from "@/features/github/domain/observation";
import type { CheckSeverity } from "../domain/monitor-provider";

export type ComplianceResultAlertKind = "failure" | "sustained_unknown" | "stale" | "recovery";

type IncidentKind = Exclude<ComplianceResultAlertKind, "recovery">;

export type ActiveComplianceResultIncident = {
  kind: IncidentKind;
  incidentKey: string;
  startedAt: string;
};

export type ComplianceResultAlertInput = {
  organisationId: string;
  repositoryId: string;
  repositorySlug: string;
  checkId: ExpectedGitHubCheckId;
  previousOutcome: ObservationResult | null;
  current: {
    id: string;
    outcome: ObservationResult;
    observedAt: string;
    freshUntil: string;
    findingId: string | null;
    evidenceId: string | null;
    severity: CheckSeverity | null;
  };
  actionableUnknownSince: string | null;
  activeIncident: ActiveComplianceResultIncident | null;
  evaluatedAt: string;
  appOrigin: string;
  allowLocalHttp?: boolean;
};

export type ComplianceResultAlertEvent = {
  kind: ComplianceResultAlertKind;
  incidentKey: string;
  idempotencyKey: string;
  incidentStartedAt: string;
  organisationId: string;
  repositoryId: string;
  checkId: ExpectedGitHubCheckId;
  text: string;
  recordUrl: string;
  slack: {
    destination: "approved_private_team_channel";
    actions: [];
  };
};

export type ComplianceResultAlertDecision =
  | { status: "event"; event: ComplianceResultAlertEvent }
  | { status: "suppressed"; reason: "unchanged_pass" | "condition_not_met" }
  | { status: "blocked"; reason: "invalid_app_origin" | "invalid_input" }
  | { status: "blocked"; kind: ComplianceResultAlertKind; incidentKey: string; reason: "missing_record" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GITHUB_REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/;
const RFC3339_TIMESTAMP_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;
const UNKNOWN_ACTIONABLE_AFTER_MS = 36 * 60 * 60 * 1000;
const OUTCOMES: ObservationResult[] = ["pass", "fail", "unknown", "not_applicable"];
const SEVERITIES: CheckSeverity[] = ["low", "medium", "high", "critical"];

const EVENT_COPY: Record<ComplianceResultAlertKind, string> = {
  failure: "A GitHub compliance check failed. An Owner or Admin should review it.",
  sustained_unknown: "A GitHub check could not be verified for 36 hours. An Owner or Admin should review it.",
  stale: "A GitHub compliance result is out of date. An Owner or Admin should check the latest collection.",
  recovery: "A GitHub compliance check passed again. An Owner or Admin can review the updated record.",
};

function isTimestamp(value: string | null): value is string {
  if (!value || !RFC3339_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function canonicalTimestamp(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function validAppOrigin(value: string, allowLocalHttp = false): string | null {
  try {
    const url = new URL(value);
    const isLocalHttp = allowLocalHttp
      && url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!isLocalHttp && url.protocol !== "https:")
      || url.username !== ""
      || url.password !== ""
      || url.pathname !== "/"
      || url.search !== ""
      || url.hash !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isValidInput(input: ComplianceResultAlertInput): boolean {
  const observedAt = Date.parse(input.current.observedAt);
  const freshUntil = Date.parse(input.current.freshUntil);
  const activeIncident = input.activeIncident;
  if (!UUID_PATTERN.test(input.organisationId)
    || !UUID_PATTERN.test(input.repositoryId)
    || !UUID_PATTERN.test(input.current.id)
    || (input.current.findingId !== null && !UUID_PATTERN.test(input.current.findingId))
    || (input.current.evidenceId !== null && !UUID_PATTERN.test(input.current.evidenceId))
    || !GITHUB_REPOSITORY_SLUG_PATTERN.test(input.repositorySlug)
    || !EXPECTED_GITHUB_CHECK_IDS.includes(input.checkId)
    || !OUTCOMES.includes(input.current.outcome)
    || (input.previousOutcome !== null && !OUTCOMES.includes(input.previousOutcome))
    || !isTimestamp(input.current.observedAt)
    || !isTimestamp(input.current.freshUntil)
    || !isTimestamp(input.evaluatedAt)
    || freshUntil <= observedAt
    || observedAt > Date.parse(input.evaluatedAt)
    || !validAppOrigin(input.appOrigin, input.allowLocalHttp)) return false;

  if (input.actionableUnknownSince !== null && !isTimestamp(input.actionableUnknownSince)) return false;
  if (activeIncident && (!(["failure", "sustained_unknown", "stale"] as const).includes(activeIncident.kind)
    || !/^[0-9a-f]{64}$/.test(activeIncident.incidentKey)
    || !isTimestamp(activeIncident.startedAt))) return false;

  if ((input.current.outcome === "fail") !== (input.current.severity !== null)) return false;
  if (input.current.severity !== null && !SEVERITIES.includes(input.current.severity)) return false;
  if (input.current.outcome === "fail") {
    return input.current.findingId !== null && input.current.evidenceId === null;
  }
  if (input.current.outcome === "pass") {
    return input.current.findingId === null;
  }
  return input.current.findingId === null && input.current.evidenceId === null;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deriveIncidentKey(input: ComplianceResultAlertInput, kind: IncidentKind, startedAt: string): string {
  const currentResultIdentity = kind === "failure" || kind === "stale" ? input.current.id : "";
  return digest([
    input.organisationId,
    input.repositoryId,
    input.checkId,
    kind,
    canonicalTimestamp(startedAt),
    currentResultIdentity,
  ].join("\n"));
}

function exactRecordUrl(input: ComplianceResultAlertInput, appOrigin: string): string | null {
  let path: string;
  let recordId: string | null;
  let queryKey: "finding" | "evidence";
  if (input.current.outcome === "fail") {
    recordId = input.current.findingId;
    queryKey = "finding";
    if (!recordId) return null;
    path = `/app/monitoring?finding=${encodeURIComponent(recordId)}#finding-${encodeURIComponent(recordId)}`;
  } else if (input.current.outcome === "pass") {
    recordId = input.current.evidenceId;
    queryKey = "evidence";
    if (!recordId) return null;
    path = `/app/evidence?evidence=${encodeURIComponent(recordId)}#evidence-${encodeURIComponent(recordId)}`;
  } else {
    path = `/app/monitoring/github-results/${input.current.id}`;
    const target = new URL(path, `${appOrigin}/`);
    return target.origin === appOrigin && target.pathname === path && !target.search && !target.hash
      ? target.href
      : null;
  }

  const target = new URL(path, `${appOrigin}/`);
  if (target.origin !== appOrigin
    || target.searchParams.get(queryKey) !== recordId
    || target.hash !== `#${queryKey}-${recordId}`) return null;
  return target.href;
}

function decideKind(input: ComplianceResultAlertInput): {
  kind: ComplianceResultAlertKind;
  incidentKey: string;
  incidentStartedAt: string;
} | null {
  const now = Date.parse(input.evaluatedAt);
  const stale = now >= Date.parse(input.current.freshUntil);

  if (stale) {
    if (input.activeIncident?.kind === "stale"
      && Date.parse(input.activeIncident.startedAt) === Date.parse(input.current.observedAt)) return null;
    const incidentKey = input.activeIncident?.incidentKey
      ?? deriveIncidentKey(input, "stale", input.current.observedAt);
    return { kind: "stale", incidentKey, incidentStartedAt: canonicalTimestamp(input.current.observedAt) };
  }

  if (input.current.outcome === "pass") {
    if (!input.activeIncident) return null;
    if (Date.parse(input.current.observedAt) <= Date.parse(input.activeIncident.startedAt)) return null;
    return {
      kind: "recovery",
      incidentKey: input.activeIncident.incidentKey,
      incidentStartedAt: canonicalTimestamp(input.activeIncident.startedAt),
    };
  }

  if (input.current.outcome === "fail") {
    if (input.activeIncident?.kind === "failure") return null;
    const incidentStartedAt = input.current.observedAt;
    return {
      kind: "failure",
      incidentKey: input.activeIncident?.incidentKey
        ?? deriveIncidentKey(input, "failure", incidentStartedAt),
      incidentStartedAt: canonicalTimestamp(incidentStartedAt),
    };
  }

  if (input.current.outcome === "unknown"
    && input.actionableUnknownSince
    && now - Date.parse(input.actionableUnknownSince) >= UNKNOWN_ACTIONABLE_AFTER_MS) {
    if (input.activeIncident?.kind === "sustained_unknown"
      && Date.parse(input.activeIncident.startedAt) === Date.parse(input.actionableUnknownSince)) return null;
    const incidentKey = input.activeIncident?.incidentKey
      ?? deriveIncidentKey(input, "sustained_unknown", input.actionableUnknownSince);
    return {
      kind: "sustained_unknown",
      incidentKey,
      incidentStartedAt: canonicalTimestamp(input.actionableUnknownSince),
    };
  }

  return null;
}

export function buildComplianceResultAlertEvent(
  input: ComplianceResultAlertInput,
): ComplianceResultAlertDecision {
  const origin = validAppOrigin(input.appOrigin, input.allowLocalHttp);
  if (!origin) return { status: "blocked", reason: "invalid_app_origin" };
  if (!isValidInput(input)) return { status: "blocked", reason: "invalid_input" };

  if (input.current.outcome === "pass" && input.previousOutcome === "pass" && !input.activeIncident
    && Date.parse(input.evaluatedAt) < Date.parse(input.current.freshUntil)) {
    return { status: "suppressed", reason: "unchanged_pass" };
  }

  const decision = decideKind(input);
  if (!decision) return { status: "suppressed", reason: "condition_not_met" };
  const url = exactRecordUrl(input, origin);
  if (!url) return {
    status: "blocked",
    kind: decision.kind,
    incidentKey: decision.incidentKey,
    reason: "missing_record",
  };

  const event: ComplianceResultAlertEvent = {
    kind: decision.kind,
    incidentKey: decision.incidentKey,
    idempotencyKey: digest(`${decision.kind}\n${decision.incidentKey}`),
    incidentStartedAt: decision.incidentStartedAt,
    organisationId: input.organisationId,
    repositoryId: input.repositoryId,
    checkId: input.checkId,
    text: `${EVENT_COPY[decision.kind]}\nRepository: ${input.repositorySlug}\nCheck: ${input.checkId}\nOpen the matching ComplianceHub record: ${url}`,
    recordUrl: url,
    slack: { destination: "approved_private_team_channel", actions: [] },
  };
  return { status: "event", event };
}
