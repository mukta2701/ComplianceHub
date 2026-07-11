import { describe, expect, expectTypeOf, it } from "vitest";
import {
  deriveSoaReviewState,
  filterSoaQueue,
  summariseSoaQueue,
  type SoaDomain,
  type SoaQueueFilters,
  type SoaQueueItem,
} from "./review-queue";

const baseItem: SoaQueueItem = {
  id: "item-1",
  controlId: "control-1",
  code: "A.5.1",
  title: "Policies for information security",
  domain: "organisational",
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
  it("uses the SoA domain union for queue items and filters", () => {
    expectTypeOf<SoaQueueItem["domain"]>().toEqualTypeOf<SoaDomain>();
    expectTypeOf<NonNullable<SoaQueueFilters["domain"]>>().toEqualTypeOf<SoaDomain>();
  });

  it("flags a pending decision before every other issue", () => {
    expect(deriveSoaReviewState(queueItem({
      status: "pending",
      justification: " ",
      ownerId: null,
      evidenceTotal: 0,
      evidenceExpired: 0,
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
      evidenceExpired: 0,
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
      evidenceExpiring: 0,
      evidenceExpired: 0,
    }))).toBe("reviewed");
  });

  it.each([
    { evidenceTotal: -1 },
    { evidenceExpiring: -1 },
    { evidenceExpired: -1 },
  ])("rejects negative evidence counters: %o", (overrides) => {
    expect(() => deriveSoaReviewState(queueItem(overrides))).toThrow(RangeError);
  });

  it.each([
    { evidenceTotal: 1.5 },
    { evidenceExpiring: 0.5 },
    { evidenceExpired: 0.5 },
  ])("rejects non-integer evidence counters: %o", (overrides) => {
    expect(() => deriveSoaReviewState(queueItem(overrides))).toThrow(RangeError);
  });

  it.each([
    { evidenceTotal: 1, evidenceExpiring: 2 },
    { evidenceTotal: 1, evidenceExpired: 2 },
  ])("rejects an evidence status counter above the total: %o", (overrides) => {
    expect(() => deriveSoaReviewState(queueItem(overrides))).toThrow(RangeError);
  });

  it("rejects combined expiring and expired counters above the total", () => {
    expect(() => deriveSoaReviewState(queueItem({
      evidenceTotal: 2,
      evidenceExpiring: 1,
      evidenceExpired: 2,
    }))).toThrow(RangeError);
  });
});

describe("filterSoaQueue", () => {
  const items = [
    queueItem({
      id: "item-1",
      code: "A.5.1",
      title: "Policies for information security",
      domain: "organisational",
      ownerId: "member-1",
      position: 1,
      reviewState: "reviewed",
    }),
    queueItem({
      id: "item-2",
      code: "A.6.3",
      title: "Information security awareness",
      domain: "people",
      ownerId: null,
      ownerName: null,
      position: 2,
      reviewState: "missing_owner",
    }),
    queueItem({
      id: "item-3",
      code: "A.8.8",
      title: "Management of technical vulnerabilities",
      domain: "technological",
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
    expect(filterSoaQueue(items, { domain: "people" }).map((item) => item.id)).toEqual(["item-2"]);
    expect(filterSoaQueue(items, { ownerId: "member-2" }).map((item) => item.id)).toEqual(["item-3"]);
    expect(filterSoaQueue(items, { ownerId: null }).map((item) => item.id)).toEqual(["item-2"]);
    expect(filterSoaQueue(items, { applicable: false }).map((item) => item.id)).toEqual(["item-3"]);
    expect(filterSoaQueue(items, { status: "not_applicable" }).map((item) => item.id)).toEqual(["item-3"]);
  });

  it("combines filters and returns ascending positions without mutating unsorted input", () => {
    const unsortedItems = [
      queueItem({ id: "item-8", domain: "people", position: 8, reviewState: "missing_evidence" }),
      queueItem({ id: "item-5", domain: "organisational", position: 5, reviewState: "reviewed" }),
      queueItem({ id: "item-2", domain: "people", position: 2, reviewState: "missing_owner" }),
    ];
    const before = structuredClone(unsortedItems);

    expect(filterSoaQueue(unsortedItems, {
      domain: "people",
      reviewState: "needs_attention",
    }).map((item) => item.position)).toEqual([2, 8]);
    expect(unsortedItems).toEqual(before);
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
      queueItem({ id: "decision", status: "pending", reviewState: "missing_decision" }),
      queueItem({ id: "rationale", justification: " ", reviewState: "missing_rationale" }),
      queueItem({ id: "owner", ownerId: null, reviewState: "missing_owner" }),
      queueItem({ id: "evidence", evidenceTotal: 0, reviewState: "missing_evidence" }),
      queueItem({ id: "stale", evidenceExpired: 1, reviewState: "stale_evidence" }),
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

  it("counts every blocker on an item while retaining its primary review outcome", () => {
    const item = queueItem({
      status: "pending",
      justification: "\n\t ",
      ownerId: null,
      evidenceTotal: 0,
      reviewState: "missing_decision",
    });

    expect(summariseSoaQueue([item])).toEqual({
      total: 1,
      needsAttention: 1,
      reviewed: 0,
      missingRationale: 1,
      evidenceGaps: 1,
      unassigned: 1,
      undecided: 1,
    });
  });
});
