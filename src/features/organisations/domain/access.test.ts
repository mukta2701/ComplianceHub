import { describe, expect, it } from "vitest";
import { canInviteRole, canManageMembership, hasCapability, roleLabel } from "./access";

describe("workspace access policy", () => {
  it("lets owners and admins run monitoring without granting broader monitoring management", () => {
    expect(hasCapability("owner", "run_monitoring")).toBe(true);
    expect(hasCapability("admin", "run_monitoring")).toBe(true);
    expect(hasCapability("member", "run_monitoring")).toBe(false);
    expect(hasCapability("owner", "manage_monitoring")).toBe(true);
    expect(hasCapability("admin", "manage_monitoring")).toBe(false);
  });

  it("limits invitation role delegation", () => {
    expect(canInviteRole("owner", "admin")).toBe(true);
    expect(canInviteRole("owner", "member")).toBe(true);
    expect(canInviteRole("admin", "member")).toBe(true);
    expect(canInviteRole("admin", "admin")).toBe(false);
    expect(canInviteRole("member", "member")).toBe(false);
    expect(canInviteRole("owner", "owner")).toBe(false);
  });

  it("lets admins manage only ordinary members", () => {
    expect(canManageMembership("admin", "member", "member")).toBe(true);
    expect(canManageMembership("admin", "member", "admin")).toBe(false);
    expect(canManageMembership("admin", "admin", "member")).toBe(false);
    expect(canManageMembership("admin", "owner", "member")).toBe(false);
    expect(canManageMembership("owner", "admin", "member")).toBe(true);
    expect(canManageMembership("owner", "member", "owner")).toBe(true);
  });

  it("provides consistent role labels", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("member")).toBe("Member");
  });
});
