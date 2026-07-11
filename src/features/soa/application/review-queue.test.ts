import { describe, expect, it } from "vitest";
import {
  deriveSoaReviewState,
  filterSoaQueue,
  summariseSoaQueue,
  type SoaQueueItem,
} from "./review-queue";

const baseItem: SoaQueueItem = {
  id: "item-1",
  controlId: "control-1",
  code: "A.5.1",
  title: "Policies for information security",
  domain: "Organisational",
  applicable: true,
  status: "operational",
  justification: "Required by the security programme",
  evidenceText: "Information security policy",
  ownerId: "member-1",
  ownerName: "Alex Owner",
  evidenceTotal: 1,
  evidenceExpiring: 0,
  evidenceExpired: 0,
  openTaskCount: 0,
  position: 1,
  reviewState: "reviewed",
};

function queueItem(overrides: Partial<SoaQueueItem> = {}): SoaQueueItem {
  return { ...baseItem, ...overrides };
}

describe("deriveSoaReviewState", () => {
  it("flags a pending decision before every other issue", () => {
    expect(deriveSoaReviewState(queueItem({
      status: "pending",
      justification: " ",
      ownerId: null,
      evidenceTotal: 0,
      evidenceExpired: 1,
    }))).toBe("missing_decision");
  });

  it("flags a whitespace-only rationale before ownership and evidence issues", () => {
    expect(deriveSoaReviewState(queueItem({
      justification: " \n\t ",
      ownerId: null,
      evidenceTotal: 0,
    }))).toBe("missing_rationale");
  });

  it("flags missing ownership before evidence issues", () => {
    expect(deriveSoaReviewState(queueItem({
      ownerId: null,
      evidenceTotal: 0,
      evidenceExpired: 1,
    }))).toBe("missing_owner");
  });

  it("flags an applicable item with no evidence", () => {
    expect(deriveSoaReviewState(queueItem({ evidenceTotal: 0 }))).toBe("missing_evidence");
  });

  it("flags expired evidence after confirming evidence exists", () => {
    expect(deriveSoaReviewState(queueItem({
      evidenceTotal: 2,
      evidenceExpired: 1,
    }))).toBe("stale_evidence");
  });

  it("reviews an applicable item with rationale, owner, and live evidence", () => {
    expect(deriveSoaReviewState(queueItem())).toBe("reviewed");
  });

  it("reviews a valid not-applicable item without evidence", () => {
    expect(deriveSoaReviewState(queueItem({
      applicable: false,
      status: "not_applicable",
      justification: "The service does not perform software development",
      evidenceText: "",
      evidenceTotal: 0,
    }))).toBe("reviewed");
  });
});

describe("filterSoaQueue", () => {
  const items = [
    queueItem({
      id: "item-1",
      code: "A.5.1",
      title: "Policies for information security",
      domain: "Organisational",
      ownerId: "member-1",
      position: 1,
      reviewState: "reviewed",
    }),
    queueItem({
      id: "item-2",
      code: "A.6.3",
      title: "Information security awareness",
      domain: "People",
      ownerId: null,
      ownerName: null,
      position: 2,
      reviewState: "missing_owner",
    }),
    queueItem({
      id: "item-3",
      code: "A.8.8",
      title: "Management of technical vulnerabilities",
      domain: "Technological",
      applicable: false,
      status: "not_applicable",
      ownerId: "member-2",
      ownerName: "Taylor Reviewer",
      position: 3,
      reviewState: "missing_rationale",
    }),
  ];

  it("searches code and title case-insensitively", () => {
    expect(filterSoaQueue(items, { search: "  a.6.3  " }).map((item) => item.id)).toEqual(["item-2"]);
    expect(filterSoaQueue(items, { search: "TECHNICAL vulnerabilities" }).map((item) => item.id)).toEqual(["item-3"]);
  });

  it("filters by an exact review state", () => {
    expect(filterSoaQueue(items, { reviewState: "missing_owner" }).map((item) => item.id)).toEqual(["item-2"]);
  });

  it("supports the needs-attention review state", () => {
    expect(filterSoaQueue(items, { reviewState: "needs_attention" }).map((item) => item.id)).toEqual(["item-2", "item-3"]);
  });

  it("filters by domain, owner, applicability, and status", () => {
    expect(filterSoaQueue(items, { domain: "People" }).map((item) => item.id)).toEqual(["item-2"]);
    expect(filterSoaQueue(items, { ownerId: "member-2" }).map((item) => item.id)).toEqual(["item-3"]);
    expect(filterSoaQueue(items, { ownerId: null }).map((item) => item.id)).toEqual(["item-2"]);
    expect(filterSoaQueue(items, { applicable: false }).map((item) => item.id)).toEqual(["item-3"]);
    expect(filterSoaQueue(items, { status: "not_applicable" }).map((item) => item.id)).toEqual(["item-3"]);
  });

  it("combines filters and preserves the input position order", () => {
    const orderedItems = [
      queueItem({ id: "item-2", domain: "People", position: 2, reviewState: "missing_owner" }),
      queueItem({ id: "item-5", domain: "Organisational", position: 5, reviewState: "reviewed" }),
      queueItem({ id: "item-8", domain: "People", position: 8, reviewState: "missing_evidence" }),
    ];

    expect(filterSoaQueue(orderedItems, {
      domain: "People",
      reviewState: "needs_attention",
    }).map((item) => item.position)).toEqual([2, 8]);
  });

  it("does not mutate the input array or its items", () => {
    const before = structuredClone(items);

    filterSoaQueue(items, { search: "security", reviewState: "needs_attention" });

    expect(items).toEqual(before);
  });
});

describe("summariseSoaQueue", () => {
  it("counts review outcomes for the queue", () => {
    const items = [
      queueItem({ id: "decision", reviewState: "missing_decision" }),
      queueItem({ id: "rationale", reviewState: "missing_rationale" }),
      queueItem({ id: "owner", reviewState: "missing_owner" }),
      queueItem({ id: "evidence", reviewState: "missing_evidence" }),
      queueItem({ id: "stale", reviewState: "stale_evidence" }),
      queueItem({ id: "reviewed", reviewState: "reviewed" }),
    ];

    expect(summariseSoaQueue(items)).toEqual({
      total: 6,
      needsAttention: 5,
      reviewed: 1,
      missingRationale: 1,
      evidenceGaps: 2,
      unassigned: 1,
      undecided: 1,
    });
  });
});
