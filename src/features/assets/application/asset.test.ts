import { describe, expect, it } from "vitest";
import { assetInputSchema } from "./asset";

describe("asset application input", () => {
  it("accepts a complete asset record", () => {
    expect(assetInputSchema.safeParse({ organisationId: "00000000-0000-4000-8000-000000000001", reference: "A-001", description: "Primary customer database", ownerLocation: "London DC", ownerId: "00000000-0000-4000-8000-000000000002", classification: "confidential", valueCriticality: "high", categoryId: "00000000-0000-4000-8000-0000000000c1", securityControls: "Encrypted at rest, access logged", lifespan: "5 years", lastUpdated: "2026-06-01", remarks: "Reviewed annually" }).success).toBe(true);
  });

  it("rejects an invalid classification value", () => {
    expect(assetInputSchema.safeParse({ organisationId: "00000000-0000-4000-8000-000000000001", reference: "A-001", description: "Primary customer database", classification: "top_secret", valueCriticality: "high" }).success).toBe(false);
  });

  it("rejects an invalid valueCriticality value", () => {
    expect(assetInputSchema.safeParse({ organisationId: "00000000-0000-4000-8000-000000000001", reference: "A-001", description: "Primary customer database", classification: "confidential", valueCriticality: "extreme" }).success).toBe(false);
  });

  it("rejects a record missing the required description field", () => {
    expect(assetInputSchema.safeParse({ organisationId: "00000000-0000-4000-8000-000000000001", reference: "A-001", classification: "confidential", valueCriticality: "high" }).success).toBe(false);
  });
});
