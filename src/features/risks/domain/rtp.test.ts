import { describe, expect, it } from "vitest";
import { summariseRtpProgress } from "./rtp";

describe("summariseRtpProgress", () => {
  it("reports zero for no plans and never claims completion", () => {
    expect(summariseRtpProgress([])).toEqual({ total: 0, completed: 0, open: 0, allComplete: false });
  });
  it("counts completed/cancelled as closed and flags all-complete", () => {
    expect(summariseRtpProgress([{ status: "completed" }, { status: "cancelled" }])).toEqual({ total: 2, completed: 1, open: 0, allComplete: true });
  });
  it("reports open work while any plan is planned or in progress", () => {
    expect(summariseRtpProgress([{ status: "completed" }, { status: "in_progress" }])).toEqual({ total: 2, completed: 1, open: 1, allComplete: false });
  });
});
