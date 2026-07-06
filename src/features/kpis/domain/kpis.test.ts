import { describe, expect, it } from "vitest";
import { MEASUREMENT_TYPE_LABEL, needsReview } from "./kpis";

describe("measurement type labels", () => {
  it("labels every measurement type in en-GB", () => {
    expect(MEASUREMENT_TYPE_LABEL.automatic).toBe("Automatic");
    expect(MEASUREMENT_TYPE_LABEL.external).toBe("External");
  });
});

describe("needsReview", () => {
  it("flags never-reviewed and stale KPIs, not recent ones", () => {
    expect(needsReview(null, "2026-07-06")).toBe(true);
    expect(needsReview("2026-01-01", "2026-07-06")).toBe(true); // > 90 days
    expect(needsReview("2026-06-01", "2026-07-06")).toBe(false);
  });
});
