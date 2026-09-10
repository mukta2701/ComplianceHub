import { describe, expect, it } from "vitest";
import { nextRtpReference, summariseRtpProgress } from "./rtp";

describe("summariseRtpProgress", () => {
  it("reports zero for no plans and never claims completion", () => {
    expect(summariseRtpProgress([])).toEqual({ total: 0, completed: 0, cancelled: 0, open: 0, allComplete: false });
  });
  it("distinguishes cancelled plans from completed work", () => {
    expect(summariseRtpProgress([{ status: "completed" }, { status: "cancelled" }])).toEqual({ total: 2, completed: 1, cancelled: 1, open: 0, allComplete: false });
  });
  it("reports open work while any plan is planned or in progress", () => {
    expect(summariseRtpProgress([{ status: "completed" }, { status: "in_progress" }])).toEqual({ total: 2, completed: 1, cancelled: 0, open: 1, allComplete: false });
  });
  it("does not claim completion when every plan was cancelled", () => {
    expect(summariseRtpProgress([{ status: "cancelled" }, { status: "cancelled" }])).toEqual({ total: 2, completed: 0, cancelled: 2, open: 0, allComplete: false });
  });
  it("claims completion only when every plan was completed", () => {
    expect(summariseRtpProgress([{ status: "completed" }, { status: "completed" }])).toEqual({ total: 2, completed: 2, cancelled: 0, open: 0, allComplete: true });
  });
});

describe("nextRtpReference", () => {
  it("fills the first available number across workspace references", () => {
    expect(nextRtpReference(["RTP-003", "RTP-001", "RTP-004"])).toBe("RTP-002");
  });
  it("starts at one when the workspace has no numbered treatment references", () => {
    expect(nextRtpReference([])).toBe("RTP-001");
    expect(nextRtpReference(["CUSTOM-001", "rtp-001", "RTP-001-followup", "RTP-000"])).toBe("RTP-001");
  });
  it("ignores duplicate references and does not change the caller's list", () => {
    const references = Object.freeze(["RTP-002", "RTP-001", "RTP-001"]);
    expect(nextRtpReference(references)).toBe("RTP-003");
    expect(references).toEqual(["RTP-002", "RTP-001", "RTP-001"]);
  });
  it("continues numbering after three digits without wrapping", () => {
    const references = Array.from({ length: 999 }, (_, index) => `RTP-${String(index + 1).padStart(3, "0")}`);
    expect(nextRtpReference(references)).toBe("RTP-1000");
  });
});
