import { describe, expect, it } from "vitest";
import { summariseMeasurements } from "./measurements";

describe("summariseMeasurements", () => {
  it("returns nulls for no readings", () => {
    expect(summariseMeasurements([])).toEqual({ latest: null, previous: null, delta: null, direction: null, count: 0 });
  });

  it("sets latest but no delta for a single reading", () => {
    expect(summariseMeasurements([{ value: 12, measured_on: "2026-07-01" }])).toEqual({
      latest: 12, previous: null, delta: null, direction: null, count: 1,
    });
  });

  it("computes delta and upward direction, sorting by date regardless of input order", () => {
    const summary = summariseMeasurements([
      { value: 20, measured_on: "2026-07-03" },
      { value: 8, measured_on: "2026-07-01" },
      { value: 14, measured_on: "2026-07-02" },
    ]);
    expect(summary).toEqual({ latest: 20, previous: 14, delta: 6, direction: "up", count: 3 });
  });

  it("reports a downward direction and negative delta", () => {
    const summary = summariseMeasurements([
      { value: 30, measured_on: "2026-06-01" },
      { value: 18, measured_on: "2026-07-01" },
    ]);
    expect(summary).toEqual({ latest: 18, previous: 30, delta: -12, direction: "down", count: 2 });
  });

  it("reports a flat direction when consecutive readings are equal", () => {
    const summary = summariseMeasurements([
      { value: 5, measured_on: "2026-06-01" },
      { value: 5, measured_on: "2026-07-01" },
    ]);
    expect(summary.delta).toBe(0);
    expect(summary.direction).toBe("flat");
  });
});
