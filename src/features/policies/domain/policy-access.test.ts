import { describe, expect, it } from "vitest";
import { policyAcceptancePresentation, policyPortalAccess } from "./policy-access";

describe("policy portal access", () => {
  it("gives operators management and organisation reporting while Members get personal acknowledgement only", () => {
    expect(policyPortalAccess("owner")).toEqual({ canManage: true, loadRoster: true, showOrganisationProgress: true });
    expect(policyPortalAccess("admin")).toEqual({ canManage: true, loadRoster: true, showOrganisationProgress: true });
    expect(policyPortalAccess("member")).toEqual({ canManage: false, loadRoster: false, showOrganisationProgress: false });
  });

  it("never turns partial Member rows into an organisation-wide acceptance count", () => {
    const rows = [
      { user_id: "me", accepted_version: 2 },
      { user_id: "colleague", accepted_version: 3 },
    ];
    expect(policyAcceptancePresentation("member", "me", 3, rows, 50)).toEqual({ mode: "personal", acceptedCurrent: false });
    expect(policyAcceptancePresentation("admin", "me", 3, rows, 50)).toMatchObject({ mode: "organisation", acceptedCurrent: 1, total: 50 });
  });
});
