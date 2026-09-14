import { describe, expect, it } from "vitest";

import { formatMonitoringTime } from "./format-monitoring-time";

describe("monitoring timestamp rendering", () => {
  it.each([
    ["2026-09-04T11:22:00Z", "04 Sep 2026, 12:22"],
    ["2026-01-04T11:22:00Z", "04 Jan 2026, 11:22"],
    ["2026-08-31T23:30:00Z", "01 Sep 2026, 00:30"],
  ])("renders %s with stable English text and London daylight saving", (value, expected) => {
    expect(formatMonitoringTime(value)).toBe(expected);
  });

  it("does not depend on the host timezone", () => {
    const original = process.env.TZ;
    try {
      for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
        process.env.TZ = zone;
        expect(formatMonitoringTime("2026-09-04T11:22:00Z")).toBe("04 Sep 2026, 12:22");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("does not invent a date for malformed recorded timestamps", () => {
    expect(formatMonitoringTime("invalid")).toBeNull();
  });
});
