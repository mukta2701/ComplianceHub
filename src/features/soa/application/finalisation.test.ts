import { describe, expect, it } from "vitest";
import { collectSoaFinalisationBlockers, type SoaFinalisationItem } from "./finalisation";

const reviewedItem: SoaFinalisationItem = {
  id: "item-1",
  controlId: "requirement-1",
  applicable: true,
  status: "operational",
  justification: "The control is implemented and reviewed.",
  ownerId: "member-1",
};

describe("collectSoaFinalisationBlockers", () => {
  it("returns no blockers for reviewed items with live linked evidence", () => {
    expect(collectSoaFinalisationBlockers([reviewedItem], new Set(["requirement-1"]))).toEqual({
      pending: [],
      missingRationale: [],
      unassigned: [],
      missingEvidence: [],
    });
  });

  it("reports every independent blocker on an applicable item", () => {
    const item = {
      ...reviewedItem,
      status: "pending" as const,
      justification: "  ",
      ownerId: null,
    };

    expect(collectSoaFinalisationBlockers([item], new Set())).toEqual({
      pending: ["item-1"],
      missingRationale: ["item-1"],
      unassigned: ["item-1"],
      missingEvidence: ["item-1"],
    });
  });

  it("does not require linked evidence for a non-applicable item", () => {
    expect(collectSoaFinalisationBlockers([{
      ...reviewedItem,
      applicable: false,
      status: "not_applicable",
    }], new Set())).toEqual({
      pending: [],
      missingRationale: [],
      unassigned: [],
      missingEvidence: [],
    });
  });
});
