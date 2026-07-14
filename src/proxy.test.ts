import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("Supabase session refresh matcher", () => {
  it("refreshes sessions and enforces access for protected pages, APIs, and invitation continuation", () => {
    expect(config.matcher).toEqual(["/app/:path*", "/api/app/:path*", "/invite"]);
  });
});
