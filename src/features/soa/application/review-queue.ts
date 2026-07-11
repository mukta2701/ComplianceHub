import type { SoaStatus } from "../domain/soa";

export type SoaReviewState =
  | "missing_decision"
  | "missing_rationale"
  | "missing_owner"
  | "missing_evidence"
  | "stale_evidence"
  | "reviewed";

export type SoaDomain = "organisational" | "people" | "physical" | "technological";

export type SoaQueueItem = {
  id: string;
  controlId: string;
  code: string;
  title: string;
  domain: SoaDomain;
  applicable: boolean;
  status: SoaStatus;
  justification: string;
  evidenceText: string;
  ownerId: string | null;
  ownerName: string | null;
  evidenceTotal: number;
  evidenceExpiring: number;
  evidenceExpired: number;
  openTaskCount: number;
  position: number;
  reviewState: SoaReviewState;
};

export type SoaQueueFilters = {
  search?: string;
  reviewState?: SoaReviewState | "needs_attention";
  domain?: SoaDomain;
  ownerId?: string | null;
  applicable?: boolean;
  status?: SoaStatus;
};

export type SoaQueueSummary = {
  total: number;
  needsAttention: number;
  reviewed: number;
  missingRationale: number;
  evidenceGaps: number;
  unassigned: number;
  undecided: number;
};

type ReviewStateInput = Pick<
  SoaQueueItem,
  | "applicable"
  | "status"
  | "justification"
  | "ownerId"
  | "evidenceTotal"
  | "evidenceExpiring"
  | "evidenceExpired"
>;

export function deriveSoaReviewState(item: ReviewStateInput): SoaReviewState {
  const counters = [item.evidenceTotal, item.evidenceExpiring, item.evidenceExpired];

  if (counters.some((counter) => !Number.isInteger(counter) || counter < 0)) {
    throw new RangeError("Evidence counters must be non-negative integers");
  }
  if (
    item.evidenceExpiring > item.evidenceTotal
    || item.evidenceExpired > item.evidenceTotal
    || item.evidenceExpiring + item.evidenceExpired > item.evidenceTotal
  ) {
    throw new RangeError("Evidence status counters cannot exceed the evidence total");
  }

  if (item.status === "pending") return "missing_decision";
  if (!item.justification.trim()) return "missing_rationale";
  if (!item.ownerId) return "missing_owner";
  if (item.applicable && item.evidenceTotal === 0) return "missing_evidence";
  if (item.applicable && item.evidenceExpired > 0) return "stale_evidence";
  return "reviewed";
}

export function filterSoaQueue(
  items: readonly SoaQueueItem[],
  filters: SoaQueueFilters,
): SoaQueueItem[] {
  const search = filters.search?.trim().toLowerCase();

  return items.filter((item) => {
    if (search && !`${item.code} ${item.title}`.toLowerCase().includes(search)) return false;
    if (filters.reviewState === "needs_attention" && item.reviewState === "reviewed") return false;
    if (filters.reviewState && filters.reviewState !== "needs_attention" && item.reviewState !== filters.reviewState) return false;
    if (filters.domain !== undefined && item.domain !== filters.domain) return false;
    if (filters.ownerId !== undefined && item.ownerId !== filters.ownerId) return false;
    if (filters.applicable !== undefined && item.applicable !== filters.applicable) return false;
    if (filters.status !== undefined && item.status !== filters.status) return false;
    return true;
  }).sort((left, right) => left.position - right.position);
}

export function summariseSoaQueue(items: readonly SoaQueueItem[]): SoaQueueSummary {
  const summary: SoaQueueSummary = {
    total: items.length,
    needsAttention: 0,
    reviewed: 0,
    missingRationale: 0,
    evidenceGaps: 0,
    unassigned: 0,
    undecided: 0,
  };

  for (const item of items) {
    if (item.reviewState === "reviewed") summary.reviewed += 1;
    else summary.needsAttention += 1;

    if (!item.justification.trim()) summary.missingRationale += 1;
    if (item.applicable && (item.evidenceTotal === 0 || item.evidenceExpired > 0)) summary.evidenceGaps += 1;
    if (!item.ownerId) summary.unassigned += 1;
    if (item.status === "pending") summary.undecided += 1;
  }

  return summary;
}
