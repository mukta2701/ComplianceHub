import { describe, expect, it } from "vitest";
import { assessScopeProfile } from "./scope-profile";

describe("assessScopeProfile", () => {
  it("identifies the plain-language scope decisions still needed before audit planning", () => {
    expect(assessScopeProfile({ scopeStatement: "", services: "Payments API", locations: "", informationTypes: "Customer data", dependencies: "Cloud host", exclusions: "" })).toEqual([
      "Describe the ISMS boundary and intended outcomes.",
      "Record the people, offices, or remote-working locations in scope.",
      "Record any exclusions and the documented reason for each one.",
    ]);
  });

  it("returns no gaps for a complete reviewable scope profile", () => {
    expect(assessScopeProfile({ scopeStatement: "The ISMS covers our SaaS service.", services: "SaaS operations", locations: "UK remote team", informationTypes: "Customer and employee data", dependencies: "AWS and Google Workspace", exclusions: "None" })).toEqual([]);
  });
});
