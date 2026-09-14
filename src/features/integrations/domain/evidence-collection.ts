import { createHash } from "node:crypto";
import type { CollectedEvidence } from "./evidence-provider";
import type { EvidenceProviderKind } from "./evidence-provider";

// The row shape to persist into public.evidence for one auto-collected item.
// Auto-collected evidence lands as 'current'; the daily freshness sweep ages it
// to 'expiring'/'expired' from valid_until. source_id, external_ref and the
// observation key identify one exact provider result.
export type EvidenceRow = {
  organisation_id: string;
  title: string;
  kind: "link" | "note";
  url: string | null;
  description: string;
  status: "current";
  collected_on: string;
  valid_until: string | null;
  source_id: string;
  external_ref: string;
  observation_key: string;
};

function optionalValue(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}

// Versioned, fixed-order input makes collection identity independent from write
// timing or Automation assignment. Optional absent values share one form.
export function observationKey(provider: EvidenceProviderKind, collected: CollectedEvidence): string {
  const canonical = JSON.stringify([
    provider,
    collected.externalRef,
    collected.kind,
    collected.title,
    optionalValue(collected.note),
    optionalValue(collected.url),
    collected.collectedOn,
    optionalValue(collected.validUntil),
  ]);
  return `v1:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

// Pure mapping: a provider item -> the evidence row for its source. A 'link'
// item stores its url (description empty); a 'note' item stores its text in
// description (url null), matching the evidence kind check constraint.
export function toEvidenceRow(
  collected: CollectedEvidence,
  context: { organisationId: string; sourceId: string; provider: EvidenceProviderKind },
): EvidenceRow {
  return {
    organisation_id: context.organisationId,
    title: collected.title,
    kind: collected.kind,
    url: collected.kind === "link" ? collected.url ?? null : null,
    description: collected.note ?? "",
    status: "current",
    collected_on: collected.collectedOn,
    valid_until: collected.validUntil,
    source_id: context.sourceId,
    external_ref: collected.externalRef,
    observation_key: observationKey(context.provider, collected),
  };
}
