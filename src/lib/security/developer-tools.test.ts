import { describe, expect, it } from "vitest";
import { canShowDeveloperTools } from "./developer-tools";

describe("developer tool visibility", () => {
  it("is available during ordinary local development", () => {
    expect(canShowDeveloperTools({ nodeEnv: "development", enabled: false, siteUrl: "https://example.com" })).toBe(true);
  });

  it("requires both an explicit flag and a loopback site outside development", () => {
    expect(canShowDeveloperTools({ nodeEnv: "production", enabled: false, siteUrl: "http://127.0.0.1:3000" })).toBe(false);
    expect(canShowDeveloperTools({ nodeEnv: "production", enabled: true, siteUrl: "http://127.0.0.1:3000" })).toBe(true);
    expect(canShowDeveloperTools({ nodeEnv: "production", enabled: true, siteUrl: "http://localhost:3000" })).toBe(true);
    expect(canShowDeveloperTools({ nodeEnv: "production", enabled: true, siteUrl: "https://compliance.example" })).toBe(false);
    expect(canShowDeveloperTools({ nodeEnv: "production", enabled: true, siteUrl: "not-a-url" })).toBe(false);
  });
});
