import { describe, expect, it } from "vitest";
import { automationSetupSchema, buildSetupSelections } from "./setup";

describe("automation setup", () => {
  it("deduplicates selected systems and prepares explicit consent records", () => {
    const selections = buildSetupSelections(automationSetupSchema.parse({
      providers: ["github", "google_workspace", "github", "linear"],
      identityOwnerId: "member-identity",
      engineeringOwnerId: "member-engineering",
      cloudOwnerId: "member-cloud",
      complianceOwnerId: "member-compliance",
    }));

    expect(selections.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "github", area: "engineering", label: "GitHub", consent: expect.objectContaining({ version: 1, contentAnalysis: true }) }),
      expect.objectContaining({ provider: "google_workspace", area: "identity" }),
      expect.objectContaining({ provider: "linear", area: "compliance" }),
    ]));
    expect(selections.connections).toHaveLength(3);
    expect(selections.assignments).toContainEqual({ area: "cloud", ownerId: "member-cloud" });
  });

  it("requires a named owner for every automation area", () => {
    expect(automationSetupSchema.safeParse({
      providers: ["aws"], identityOwnerId: "", engineeringOwnerId: "member-engineering", cloudOwnerId: "member-cloud", complianceOwnerId: "member-compliance",
    }).success).toBe(false);
  });
});
