import { describe, expect, it } from "vitest";
import { crosswalkInputSchema } from "./crosswalk";

const validInput = {
  organisationId: "20000000-0000-4000-8000-000000000001",
  controlId: "30000000-0000-4000-8000-000000000001",
  framework: "soc_2",
  externalRef: "CC6.1",
  note: "Our access-control interpretation for this published reference.",
} as const;

describe("crosswalkInputSchema", () => {
  it("requires a non-empty organisation rationale for every new mapping", () => {
    expect(crosswalkInputSchema.safeParse(validInput).success).toBe(true);
    expect(crosswalkInputSchema.safeParse({ ...validInput, note: "  " }).success).toBe(false);
    expect(crosswalkInputSchema.safeParse({ ...validInput, note: undefined }).success).toBe(false);
  });
});
