import { describe, expect, it } from "vitest";
import { safeSummary } from "./safe-summary";

describe("safeSummary", () => {
  it("removes contact, credential, URL, and markup-shaped content", () => {
    expect(safeSummary("  Review <b>owner@example.com</b> at https://secret.test/x Bearer abc.def token=xyz  ", 120))
      .toBe("Review [redacted] at [redacted]");
  });

  it("truncates by Unicode code point and supplies a safe fallback", () => {
    expect(safeSummary("😀😀😀", 2)).toBe("😀…");
    expect(safeSummary(" <script> ", 40)).toBe("[redacted]");
    expect(safeSummary("   ", 40, "Untitled item")).toBe("Untitled item");
  });

  it("redacts common standalone credential shapes", () => {
    expect(safeSummary("Found sk-proj-1234567890 and eyJhbGciOiJIUzI1NiJ9.abcdefgh.signature", 120))
      .toBe("Found [redacted] and [redacted]");
  });

  it("removes unmatched angle brackets as well as complete markup", () => {
    expect(safeSummary("Risk < threshold > target and dangling <tag", 120)).toBe("Risk [redacted] target and dangling tag");
  });
});
