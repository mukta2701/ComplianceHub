import { describe, expect, it } from "vitest";
import { soaItemReviewSchema } from "./review";

describe("SoA review input", () => {
  it("requires a justification before an item can be reviewed", () => {
    expect(soaItemReviewSchema.safeParse({ itemId: "00000000-0000-4000-8000-000000000001", status: "operational", applicable: true, justification: "", evidence: "" }).success).toBe(false);
  });

  it("forces not-applicable status when applicability is false", () => {
    expect(soaItemReviewSchema.safeParse({ itemId: "00000000-0000-4000-8000-000000000001", status: "operational", applicable: false, justification: "Out of scope", evidence: "" }).success).toBe(false);
  });
});
