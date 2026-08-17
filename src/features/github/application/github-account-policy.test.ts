import { describe, expect, it } from "vitest";

import { resolveGitHubAccountType } from "./github-account-policy";

const INVALID_CONFIGURATION_ERROR =
  "GitHub account type configuration is invalid";

function expectInvalidConfiguration(
  input: Parameters<typeof resolveGitHubAccountType>[0],
) {
  expect(() => resolveGitHubAccountType(input)).toThrowError(
    INVALID_CONFIGURATION_ERROR,
  );
}

describe("resolveGitHubAccountType", () => {
  it("defaults missing configuration to Organization", () => {
    expect(resolveGitHubAccountType({})).toBe("Organization");
  });

  it("defaults empty configuration to Organization", () => {
    expect(resolveGitHubAccountType({ configuredType: "" })).toBe(
      "Organization",
    );
  });

  it("accepts explicit Organization in a hosted production runtime", () => {
    expect(
      resolveGitHubAccountType({
        configuredType: "Organization",
        nodeEnv: "production",
        siteUrl: "https://compliancehub.example",
      }),
    ).toBe("Organization");
  });

  it("accepts User in development at the IPv4 loopback site", () => {
    expect(
      resolveGitHubAccountType({
        configuredType: "User",
        nodeEnv: "development",
        siteUrl: "http://127.0.0.1:3000",
      }),
    ).toBe("User");
  });

  it("accepts User in test at the localhost site", () => {
    expect(
      resolveGitHubAccountType({
        configuredType: "User",
        nodeEnv: "test",
        siteUrl: "http://localhost:3000",
      }),
    ).toBe("User");
  });

  it.each([
    [
      "production runtime",
      {
        configuredType: "User",
        nodeEnv: "production",
        siteUrl: "http://localhost:3000",
      },
    ],
    [
      "HTTPS site",
      {
        configuredType: "User",
        nodeEnv: "development",
        siteUrl: "https://localhost:3000",
      },
    ],
    [
      "non-loopback site",
      {
        configuredType: "User",
        nodeEnv: "development",
        siteUrl: "http://compliancehub.example",
      },
    ],
    [
      "missing site",
      { configuredType: "User", nodeEnv: "development" },
    ],
    [
      "malformed site",
      {
        configuredType: "User",
        nodeEnv: "development",
        siteUrl: "not a URL",
      },
    ],
    [
      "username in site",
      {
        configuredType: "User",
        nodeEnv: "development",
        siteUrl: "http://pilot@localhost:3000",
      },
    ],
    [
      "password in site",
      {
        configuredType: "User",
        nodeEnv: "development",
        siteUrl: "http://pilot:secret@localhost:3000",
      },
    ],
    [
      "query in site",
      {
        configuredType: "User",
        nodeEnv: "development",
        siteUrl: "http://localhost:3000?pilot=true",
      },
    ],
    [
      "hash in site",
      {
        configuredType: "User",
        nodeEnv: "development",
        siteUrl: "http://localhost:3000#pilot",
      },
    ],
  ])("rejects User for a %s", (_case, input) => {
    expectInvalidConfiguration(input);
  });

  it.each(["user", "Enterprise", " ", "Organization "])(
    "rejects unknown configured type %j",
    (configuredType) => {
      expectInvalidConfiguration({ configuredType });
    },
  );
});
