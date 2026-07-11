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
  pending: string[];
  missingRationale: string[];
  unassigned: string[];
  missingEvidence: string[];
};

export function collectSoaFinalisationBlockers(
  items: readonly SoaFinalisationItem[],
  requirementIdsWithLiveEvidence: ReadonlySet<string>,
): SoaFinalisationBlockers {
  const blockers: SoaFinalisationBlockers = {
    pending: [],
    missingRationale: [],
    unassigned: [],
    missingEvidence: [],
  };

  for (const item of items) {
    if (item.status === "pending") blockers.pending.push(item.id);
    if (!item.justification.trim()) blockers.missingRationale.push(item.id);
    if (!item.ownerId) blockers.unassigned.push(item.id);
    if (item.applicable && !requirementIdsWithLiveEvidence.has(item.controlId)) blockers.missingEvidence.push(item.id);
  }

  return blockers;
}

export function countSoaFinalisationBlockers(blockers: SoaFinalisationBlockers): number {
  return blockers.pending.length
    + blockers.missingRationale.length
    + blockers.unassigned.length
    + blockers.missingEvidence.length;
}
