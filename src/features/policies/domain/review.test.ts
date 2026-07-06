import { describe, expect, it } from "vitest";
import { isPolicyReviewDue } from "./review";

describe("isPolicyReviewDue", () => {
  it("is due when the review date has passed", () => {
    expect(isPolicyReviewDue("2026-07-01", "2026-07-06")).toBe(true);
  });

  it("is due when the review date is today", () => {
    expect(isPolicyReviewDue("2026-07-06", "2026-07-06")).toBe(true);
  });

  it("is not due when the review date is in the future", () => {
    expect(isPolicyReviewDue("2026-08-01", "2026-07-06")).toBe(false);
  });

  it("is not due when there is no scheduled review date", () => {
    expect(isPolicyReviewDue(null, "2026-07-06")).toBe(false);
  });
});
