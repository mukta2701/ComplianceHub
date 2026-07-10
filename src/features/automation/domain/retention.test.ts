import { describe, expect, it } from "vitest";
import { purgeContentReference, shouldPurgeSourceObject } from "./retention";

describe("automation source retention", () => {
  it("purges pending source content once its retention deadline is reached", () => {
    expect(shouldPurgeSourceObject({ status: "pending", expiresAt: "2026-07-10T00:00:00.000Z" }, new Date("2026-07-10T00:00:00.000Z"))).toBe(true);
  });

  it("keeps accepted evidence provenance and future-dated source content", () => {
    expect(shouldPurgeSourceObject({ status: "retained", expiresAt: "2026-07-01T00:00:00.000Z" }, new Date("2026-07-10T00:00:00.000Z"))).toBe(false);
    expect(shouldPurgeSourceObject({ status: "pending", expiresAt: "2026-08-01T00:00:00.000Z" }, new Date("2026-07-10T00:00:00.000Z"))).toBe(false);
  });

  it("replaces purged content locations with a non-retrievable audit reference", () => {
    expect(purgeContentReference("abc123")).toBe("purged://abc123");
  });
});
