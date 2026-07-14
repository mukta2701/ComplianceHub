import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("Supabase session refresh matcher", () => {
  it("refreshes sessions only for the protected app and invitation continuation routes", () => {
    expect(config.matcher).toEqual(["/app/:path*", "/invite"]);
  });
});
