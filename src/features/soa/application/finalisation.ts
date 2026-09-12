import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceStatus } from "@/features/evidence/domain/evidence";
import { one } from "@/lib/supabase/one";
import type { SoaStatus } from "../domain/soa";

/** The control catalogue size finalisation requires; every decision count hangs off this. */
export const SOA_CATALOGUE_SIZE = 93;

export type SoaFinalisationItem = {
  id: string;
  controlId: string;
  applicable: boolean;
  status: SoaStatus;
  justification: string;
  ownerId: string | null;
};

export type SoaFinalisationBlockers = {
  incompleteCatalogue: boolean;
  expiredEvidence: string[];
  pending: string[];
  missingRationale: string[];
  unassigned: string[];
  missingEvidence: string[];
};

export function collectSoaFinalisationBlockers(
  items: readonly SoaFinalisationItem[],
  requirementIdsWithLiveEvidence: ReadonlySet<string>,
  requirementIdsWithExpiredEvidence: ReadonlySet<string> = new Set(),
): SoaFinalisationBlockers {
  const blockers: SoaFinalisationBlockers = {
    incompleteCatalogue: items.length !== SOA_CATALOGUE_SIZE,
    expiredEvidence: [],
    pending: [],
    missingRationale: [],
    unassigned: [],
    missingEvidence: [],
  };

  for (const item of items) {
    if (item.applicable && item.status === "pending") blockers.pending.push(item.id);
    if (!item.justification.trim()) blockers.missingRationale.push(item.id);
    if (item.applicable && !item.ownerId) blockers.unassigned.push(item.id);
    if (item.applicable && requirementIdsWithExpiredEvidence.has(item.controlId)) blockers.expiredEvidence.push(item.id);
    if (item.applicable && !requirementIdsWithLiveEvidence.has(item.controlId)) blockers.missingEvidence.push(item.id);
  }

  return blockers;
}

export function countSoaFinalisationBlockers(blockers: SoaFinalisationBlockers): number {
  return Number(blockers.incompleteCatalogue)
    + blockers.expiredEvidence.length
    + blockers.pending.length
    + blockers.missingRationale.length
    + blockers.unassigned.length
    + blockers.missingEvidence.length;
}

export type SoaRequirementControlMapping = { requirementId: string; controlId: string };
export type SoaRequirementEvidenceLink = { controlId: string | null; evidenceStatus: EvidenceStatus | null };

/**
 * Single home for the finalisation evidence rule: a requirement (SoA control) has
 * live evidence when any mapped control's stored evidence status is current or
 * expiring; expired stored evidence is recorded separately so a requirement with
 * both stays blocked.
 */
export function classifyRequirementEvidence(
  mappings: readonly SoaRequirementControlMapping[],
  links: readonly SoaRequirementEvidenceLink[],
): { live: Set<string>; expired: Set<string> } {
  const requirementIdsByControl = new Map<string, Set<string>>();
  for (const mapping of mappings) {
    const mappedRequirements = requirementIdsByControl.get(mapping.controlId) ?? new Set<string>();
    mappedRequirements.add(mapping.requirementId);
    requirementIdsByControl.set(mapping.controlId, mappedRequirements);
  }

  const live = new Set<string>();
  const expired = new Set<string>();
  for (const link of links) {
    if (!link.controlId) continue;
    const mappedRequirements = requirementIdsByControl.get(link.controlId);
    if (!mappedRequirements) continue;
    if (link.evidenceStatus === "expired") {
      for (const requirementId of mappedRequirements) expired.add(requirementId);
    } else if (link.evidenceStatus === "current" || link.evidenceStatus === "expiring") {
      for (const requirementId of mappedRequirements) live.add(requirementId);
    }
  }
  return { live, expired };
}

type PreflightItemRow = { id: string; control_id: string; applicable: boolean; status: string; justification: string; owner_id: string | null };
type PreflightMappingRow = { requirement_id: string; control_id: string };
type PreflightEvidenceLinkRow = { control_id: string | null; evidence: { status: EvidenceStatus } | { status: EvidenceStatus }[] | null };

export type SoaFinalisationPreflight = {
  items: SoaFinalisationItem[];
  liveEvidence: Set<string>;
  expiredEvidence: Set<string>;
};

/** Reads every record the finalisation blockers depend on, scoped to the active workspace. */
export async function loadSoaFinalisationPreflight(
  supabase: SupabaseClient,
  organisationId: string,
  registerId: string,
): Promise<SoaFinalisationPreflight> {
  const { data: itemRows, error: itemError } = await supabase
    .from("soa_items")
    .select("id,control_id,applicable,status,justification,owner_id")
    .eq("soa_register_id", registerId)
    .eq("organisation_id", organisationId);
  if (itemError) throw new Error("Could not load SoA finalisation preflight");

  const items = ((itemRows ?? []) as PreflightItemRow[]).map((item) => ({
    id: item.id,
    controlId: item.control_id,
    applicable: item.applicable,
    status: item.status as SoaStatus,
    justification: item.justification,
    ownerId: item.owner_id,
  }));
  const requirementIds = items.map((item) => item.controlId);
  if (!requirementIds.length) return { items, liveEvidence: new Set(), expiredEvidence: new Set() };

  const { data: mappings, error: mappingError } = await supabase
    .from("requirement_control_mappings")
    .select("requirement_id,control_id")
    .in("requirement_id", requirementIds);
  if (mappingError) throw new Error("Could not load SoA evidence mappings");

  const sharedControlIds = [...new Set(((mappings ?? []) as PreflightMappingRow[]).map((mapping) => mapping.control_id))];
  if (!sharedControlIds.length) return { items, liveEvidence: new Set(), expiredEvidence: new Set() };

  const { data: evidenceLinks, error: evidenceError } = await supabase
    .from("evidence_links")
    .select("control_id,evidence(status)")
    .eq("organisation_id", organisationId)
    .in("control_id", sharedControlIds);
  if (evidenceError) throw new Error("Could not load SoA evidence freshness");

  const { live, expired } = classifyRequirementEvidence(
    ((mappings ?? []) as PreflightMappingRow[]).map((mapping) => ({ requirementId: mapping.requirement_id, controlId: mapping.control_id })),
    ((evidenceLinks ?? []) as PreflightEvidenceLinkRow[]).map((link) => ({
      controlId: link.control_id,
      evidenceStatus: one(link.evidence)?.status ?? null,
    })),
  );
  return { items, liveEvidence: live, expiredEvidence: expired };
}
