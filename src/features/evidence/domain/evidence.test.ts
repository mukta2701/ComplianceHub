import { describe, expect, it } from "vitest";
import { deriveEvidenceStatus, summariseEvidenceFreshness } from "./evidence";

describe("deriveEvidenceStatus", () => {
  it("treats evidence without an expiry as always current", () => {
    expect(deriveEvidenceStatus(null, "2026-07-02")).toBe("current");
  });
  it("marks evidence expiring within the 30-day window", () => {
    expect(deriveEvidenceStatus("2026-08-01", "2026-07-02")).toBe("expiring");
    expect(deriveEvidenceStatus("2026-07-02", "2026-07-02")).toBe("expiring");
  });
  it("marks evidence current outside the window and expired past it", () => {
    expect(deriveEvidenceStatus("2026-08-02", "2026-07-02")).toBe("current");
    expect(deriveEvidenceStatus("2026-07-01", "2026-07-02")).toBe("expired");
  });
  it("rejects malformed dates", () => {
    expect(() => deriveEvidenceStatus("01/07/2026", "2026-07-02")).toThrow(/ISO date/);
  });
});

describe("summariseEvidenceFreshness", () => {
  it("counts totals and stale items, ignoring superseded and withdrawn", () => {
    expect(summariseEvidenceFreshness([
      { status: "current" }, { status: "expiring" }, { status: "expired" }, { status: "superseded" }, { status: "withdrawn" },
    ])).toEqual({ total: 3, expiring: 1, expired: 1 });
  });
});
