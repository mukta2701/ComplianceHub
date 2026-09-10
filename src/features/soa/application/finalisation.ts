import type { SoaStatus } from "../domain/soa";

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
    incompleteCatalogue: items.length !== 93,
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
