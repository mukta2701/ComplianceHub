import { describe, expect, it } from "vitest";

import { resolveGitHubAccountType } from "./github-account-policy";

const INVALID_CONFIGURATION_ERROR =
  /^GitHub account type configuration is invalid$/;

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
    "http://localhost",
    "http://localhost/",
    "http://localhost:1",
    "http://localhost:65535/",
    "http://127.0.0.1",
    "http://127.0.0.1/",
    "http://127.0.0.1:1",
    "http://127.0.0.1:65535/",
  ])("accepts canonical local User site %s", (siteUrl) => {
    expect(
      resolveGitHubAccountType({
        configuredType: "User",
        nodeEnv: "development",
        siteUrl,
      }),
    ).toBe("User");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["unknown", "staging"],
    ["case-varied development", "Development"],
    ["case-varied test", "TEST"],
    ["leading-whitespace", " development"],
    ["trailing-whitespace", "test "],
  ])("rejects User for a %s nodeEnv", (_case, nodeEnv) => {
    expectInvalidConfiguration({
      configuredType: "User",
      nodeEnv,
      siteUrl: "http://localhost:3000",
    });
  });

  it("keeps Organization independent of nodeEnv and site URL", () => {
    expect(
      resolveGitHubAccountType({
        configuredType: "Organization",
        nodeEnv: " staging ",
        siteUrl: "not a URL",
      }),
    ).toBe("Organization");
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

  it.each([
    ["non-root path", "http://localhost:3000/pilot"],
    ["second trailing slash", "http://localhost:3000//"],
    ["leading whitespace", " http://localhost:3000"],
    ["trailing whitespace", "http://localhost:3000 "],
    ["embedded tab canonicalization", "http://local\thost:3000"],
    ["embedded newline canonicalization", "http://local\nhost:3000"],
    ["embedded carriage return canonicalization", "http://local\rhost:3000"],
    ["empty userinfo", "http://@localhost:3000"],
    ["percent-encoded localhost", "http://%6cocalhost:3000"],
    ["percent-encoded IPv4 dots", "http://127%2e0%2e0%2e1:3000"],
    ["alternate numeric loopback", "http://127.1:3000"],
    ["localhost subdomain", "http://pilot.localhost:3000"],
    ["IPv6 loopback", "http://[::1]:3000"],
    ["zero port", "http://localhost:0"],
    ["leading-zero port", "http://localhost:03000"],
    ["invalid port", "http://localhost:pilot"],
    ["out-of-range port", "http://localhost:65536"],
  ])("rejects non-canonical User site with %s", (_case, siteUrl) => {
    expectInvalidConfiguration({
      configuredType: "User",
      nodeEnv: "development",
      siteUrl,
    });
  });

  it.each(["user", "Enterprise", " ", "Organization "])(
    "rejects unknown configured type %j",
    (configuredType) => {
      expectInvalidConfiguration({ configuredType });
    },
  );
});
