import type { CollectedEvidence } from "./evidence-provider";

// The row shape to upsert into public.evidence for one auto-collected item.
// Auto-collected evidence lands as 'current'; the daily freshness sweep ages it
// to 'expiring'/'expired' from valid_until. source_id + external_ref carry the
// dedup key so re-collection upserts the same row (Stage 2).
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
};

// Pure mapping: a provider item -> the evidence row for its source. A 'link'
// item stores its url (description empty); a 'note' item stores its text in
// description (url null), matching the evidence kind check constraint.
export function toEvidenceRow(
  collected: CollectedEvidence,
  context: { organisationId: string; sourceId: string },
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
  };
}
