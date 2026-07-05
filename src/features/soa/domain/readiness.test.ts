import { describe, expect, it } from "vitest";
import { soaReadinessWeight, summariseSoaReadiness } from "./readiness";

describe("soaReadinessWeight", () => {
  it("increases with maturity and ignores not-applicable", () => {
    expect(soaReadinessWeight("pending")).toBe(0);
    expect(soaReadinessWeight("operational")).toBeGreaterThan(soaReadinessWeight("in_progress") as number);
    expect(soaReadinessWeight("advanced")).toBe(1);
    expect(soaReadinessWeight("not_applicable")).toBeNull();
  });
});

describe("summariseSoaReadiness", () => {
  it("weights only applicable items and returns a rounded percent", () => {
    const s = summariseSoaReadiness([{ status: "advanced" }, { status: "pending" }, { status: "not_applicable" }]);
    expect(s.total).toBe(2);
    expect(s.percent).toBe(50);
  });
  it("is zero for no applicable items", () => {
    expect(summariseSoaReadiness([{ status: "not_applicable" }])).toEqual({ weightedComplete: 0, total: 0, percent: 0 });
  });
});
