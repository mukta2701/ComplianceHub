import { describe, expect, it } from "vitest";
import { isDestructiveIntegrationTargetAllowed } from "./destructive-integration-target";

describe("destructive integration target guard", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://[::1]:54321",
  ])("allows a local Supabase target by default: %s", (url) => {
    expect(isDestructiveIntegrationTargetAllowed(url)).toBe(true);
  });

  it("rejects remote, malformed, and lookalike targets unconditionally", () => {
    expect(isDestructiveIntegrationTargetAllowed("https://production.supabase.co")).toBe(false);
    expect(isDestructiveIntegrationTargetAllowed("https://127.0.0.1.evil.test")).toBe(false);
    expect(isDestructiveIntegrationTargetAllowed("not-a-url")).toBe(false);
    expect(isDestructiveIntegrationTargetAllowed(undefined)).toBe(false);
  });

  it("has no remote opt-in path", () => {
    expect(isDestructiveIntegrationTargetAllowed("https://safe-integration-ref.supabase.co")).toBe(false);
  });
});
