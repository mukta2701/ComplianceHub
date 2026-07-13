import { describe, expect, it } from "vitest";
import { shouldShowRunMonitoring } from "./monitoring-access";

describe("monitoring page access", () => {
  it.each(["owner", "admin"] as const)("shows Run checks now to an %s when a source is connected", (role) => {
    expect(shouldShowRunMonitoring(role, 1)).toBe(true);
  });

  it("hides Run checks now from members", () => {
    expect(shouldShowRunMonitoring("member", 1)).toBe(false);
  });

  it("hides Run checks now when there is nothing to run", () => {
    expect(shouldShowRunMonitoring("owner", 0)).toBe(false);
  });
});
