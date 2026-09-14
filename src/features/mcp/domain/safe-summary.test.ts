import { describe, expect, it } from "vitest";
import { safeSummary } from "./safe-summary";

describe("safeSummary", () => {
  const privateKeyBlock = ["-----BEGIN", "PRIVATE", "KEY-----abc-----END", "PRIVATE", "KEY-----"].join(" ");
  const awsAccessKeyId = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
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

  it.each([
    ["client_secret=super-sensitive-value", "super-sensitive-value"],
    [`private_key: ${privateKeyBlock}`, privateKeyBlock],
    ["private key: hidden-material", "hidden-material"],
    ["clientSecret=camel-case-value", "camel-case-value"],
    ["AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz1234567890", "abcdefghijklmnopqrstuvwxyz1234567890"],
    ["secret_access_key: abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyz"],
    [`access_key_id=${awsAccessKeyId}`, awsAccessKeyId],
    ["Authorization: Basic Zm9vOmJhcg==", "Zm9vOmJhcg=="],
    ["Authorization: Bearer abc.def.ghi", "abc.def.ghi"],
    ["signing_secret=signing-value", "signing-value"],
    ["webhook_secret: hook-value", "hook-value"],
  ])("redacts credential-bearing input without reflecting its value: %s", (value, secret) => {
    const output = safeSummary(`Finding ${value} detected`, 160);
    expect(output).toContain("[redacted]");
    expect(output).not.toContain(secret);
  });
});
