import { describe, expect, it } from "vitest";
import { connectionTargetInputSchema } from "./connection";

describe("OAuth target validation", () => {
  it.each(["%2e%2e", "acme/repo", "acme\\repo", "acme?admin=true", "acme#admin", ".", ".."])(
    "rejects unsafe GitHub target segment %s",
    (unsafe) => {
      expect(connectionTargetInputSchema.safeParse({ provider: "github", owner: unsafe, repo: "isms" }).success).toBe(false);
      expect(connectionTargetInputSchema.safeParse({ provider: "github", owner: "acme", repo: unsafe }).success).toBe(false);
    },
  );

  it("accepts a GitHub-safe owner and repository", () => {
    expect(connectionTargetInputSchema.parse({ provider: "github", owner: "acme-security", repo: ".github" }))
      .toEqual({ provider: "github", owner: "acme-security", repo: ".github" });
  });
});
