import { describe, expect, it } from "vitest";
import { safePostAuthPath } from "./auth-destination";

const RAW_INVITATION_VALUE = "A".repeat(43);

describe("safePostAuthPath", () => {
  it.each([
    `/invite?token=${RAW_INVITATION_VALUE}`,
    `/invite#${RAW_INVITATION_VALUE}`,
    "/invite?status=anything#fragment",
  ])("canonicalizes an invite continuation with query/hash to literal /invite", (candidate) => {
    const destination = safePostAuthPath(candidate);

    expect(destination).toBe("/invite");
    expect(destination).not.toContain(RAW_INVITATION_VALUE);
  });

  it("continues to preserve approved application query parameters", () => {
    expect(safePostAuthPath("/app/policies?state=draft#comments")).toBe("/app/policies?state=draft#comments");
  });
});
