import { describe, expect, it } from "vitest";
import { classifyRequirementEvidence, collectSoaFinalisationBlockers, SOA_CATALOGUE_SIZE, type SoaFinalisationItem } from "./finalisation";

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
    expect(collectSoaFinalisationBlockers([reviewedItem], new Set(["requirement-1"]))).toMatchObject({
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

    expect(collectSoaFinalisationBlockers([item], new Set())).toMatchObject({
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
    }], new Set())).toMatchObject({
      pending: [],
      missingRationale: [],
      unassigned: [],
      missingEvidence: [],
    });
  });
});


describe("database finalisation parity", () => {
  it("does not require owners or resolved pending status for excluded controls", () => {
    const result = collectSoaFinalisationBlockers([{ ...reviewedItem, applicable: false, status: "pending", ownerId: null }], new Set());
    expect(result.pending).toEqual([]);
    expect(result.unassigned).toEqual([]);
  });
  it("requires exactly 93 decisions and blocks expired stored evidence even beside current evidence", () => {
    const result = collectSoaFinalisationBlockers([reviewedItem], new Set(["requirement-1"]), new Set(["requirement-1"]));
    expect(result.incompleteCatalogue).toBe(true);
    expect(result.expiredEvidence).toEqual(["item-1"]);
    const complete = Array.from({ length: 93 }, (_, i) => ({ ...reviewedItem, id: `item-${i}`, controlId: `control-${i}`, applicable: false, ownerId: null }));
    expect(collectSoaFinalisationBlockers(complete, new Set()).incompleteCatalogue).toBe(false);
  });
});

describe("classifyRequirementEvidence", () => {
  const mappings = [
    { requirementId: "requirement-1", controlId: "control-a" },
    { requirementId: "requirement-2", controlId: "control-a" },
    { requirementId: "requirement-3", controlId: "control-b" },
  ];

  it("marks requirements live through current or expiring mapped evidence", () => {
    const { live, expired } = classifyRequirementEvidence(mappings, [
      { controlId: "control-a", evidenceStatus: "current" },
      { controlId: "control-b", evidenceStatus: "expiring" },
    ]);
    expect([...live].sort()).toEqual(["requirement-1", "requirement-2", "requirement-3"]);
    expect(expired.size).toBe(0);
  });

  it("records expired evidence separately from live evidence", () => {
    const { live, expired } = classifyRequirementEvidence(mappings, [{ controlId: "control-a", evidenceStatus: "expired" }]);
    expect(live.size).toBe(0);
    expect([...expired].sort()).toEqual(["requirement-1", "requirement-2"]);
  });

  it("keeps a requirement with both current and expired evidence in both sets", () => {
    const { live, expired } = classifyRequirementEvidence(mappings, [
      { controlId: "control-a", evidenceStatus: "current" },
      { controlId: "control-a", evidenceStatus: "expired" },
    ]);
    expect([...live].sort()).toEqual(["requirement-1", "requirement-2"]);
    expect([...expired].sort()).toEqual(["requirement-1", "requirement-2"]);
  });

  it("ignores evidence without a mapped control or a known status", () => {
    const { live, expired } = classifyRequirementEvidence(mappings, [
      { controlId: null, evidenceStatus: "current" },
      { controlId: "control-unmapped", evidenceStatus: "current" },
      { controlId: "control-a", evidenceStatus: null },
    ]);
    expect(live.size).toBe(0);
    expect(expired.size).toBe(0);
  });

  it("pins the catalogue size the blocker rule depends on", () => {
    expect(SOA_CATALOGUE_SIZE).toBe(93);
  });
});
