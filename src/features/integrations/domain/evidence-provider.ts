// B3 continuous evidence automation — the provider abstraction (mirrors the
// TicketProvider shape). A provider collects a stable set of evidence items from
// an external source; the daily freshness sweep then ages them via valid_until.
// The fake is deterministic so a collect -> re-collect (Stage 2) upserts by
// externalRef rather than duplicating.

export type EvidenceProviderKind = "google_workspace" | "github" | "aws";

export type EvidenceSourceConnection = {
  id: string;
  provider: EvidenceProviderKind;
  config: Record<string, unknown>;
  accessToken: string;
};

export type CollectedEvidence = {
  externalRef: string;
  title: string;
  kind: "link" | "note";
  url?: string;
  note?: string;
  collectedOn: string; // YYYY-MM-DD
  validUntil: string | null; // YYYY-MM-DD, or null for evidence that never expires
};

export interface EvidenceProvider {
  collect(connection: EvidenceSourceConnection): Promise<CollectedEvidence[]>;
}

// Stable id for a collected item: a hash of provider + title, matching the
// ticket fake's stableId, so re-collection yields the same externalRef.
function stableRef(provider: EvidenceProviderKind, title: string): string {
  const seed = `${provider}:${title}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `AUTO-${hash.toString(36).toUpperCase()}`;
}

// Deterministic date shift in UTC so sample validity windows never depend on the
// host timezone or the wall clock.
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The collection baseline is deterministic: it uses config.asOf when supplied
// (an ISO date string), otherwise a fixed literal, so tests are stable.
const DEFAULT_COLLECTED_ON = "2026-01-01";

function resolveCollectedOn(config: Record<string, unknown>): string {
  const asOf = config.asOf;
  return typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : DEFAULT_COLLECTED_ON;
}

type SampleItem = {
  title: string;
  kind: "link" | "note";
  url?: string;
  note?: string;
  windowDays: number | null;
};

// Original en-GB sample evidence per provider. Each item ages on its own window:
// access-control snapshots refresh quarterly, config exports monthly.
const SAMPLES: Record<EvidenceProviderKind, SampleItem[]> = {
  google_workspace: [
    { title: "MFA enforcement report", kind: "link", url: "https://admin.google.local/security/mfa", windowDays: 90 },
    { title: "Access review export", kind: "note", note: "Quarterly directory access review completed; no dormant admin accounts found.", windowDays: 90 },
  ],
  github: [
    { title: "Branch protection settings", kind: "link", url: "https://github.local/settings/branches", windowDays: 30 },
    { title: "Dependabot alerts summary", kind: "note", note: "No open critical or high dependency alerts across protected repositories.", windowDays: 30 },
  ],
  aws: [
    { title: "S3 encryption configuration", kind: "note", note: "All buckets enforce default SSE-KMS encryption with block-public-access enabled.", windowDays: 60 },
    { title: "IAM policy export", kind: "note", note: "Least-privilege review of IAM roles; no wildcard admin policies outside break-glass.", windowDays: 60 },
  ],
};

export const fakeEvidenceProvider: EvidenceProvider = {
  async collect(connection) {
    const collectedOn = resolveCollectedOn(connection.config);
    return SAMPLES[connection.provider].map((sample) => ({
      externalRef: stableRef(connection.provider, sample.title),
      title: sample.title,
      kind: sample.kind,
      url: sample.url,
      note: sample.note,
      collectedOn,
      validUntil: sample.windowDays === null ? null : shiftDate(collectedOn, sample.windowDays),
    }));
  },
};
