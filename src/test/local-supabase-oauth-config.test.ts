import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
const seed = readFileSync(resolve(process.cwd(), "supabase/seed.sql"), "utf8");
const authSection = config.match(/^\[auth\]\n([\s\S]*?)(?=^\[|\Z)/m)?.[1] ?? "";
const oauthServerSection = config.match(/^\[auth\.oauth_server\]\n([\s\S]*?)(?=^\[|\Z)/m)?.[1] ?? "";

describe("local Supabase OAuth configuration", () => {
  it("uses the local ComplianceHub origin for OAuth consent", () => {
    expect(authSection).toMatch(/^site_url = "http:\/\/127\.0\.0\.1:3100"$/m);
  });

  it("seeds the MCP audience at the configured local app origin", () => {
    const siteUrl = authSection.match(/^site_url = "([^"]+)"$/m)?.[1];
    const seededAudience = seed.match(/values\s*\(\s*'resource'\s*,\s*'([^']+)'\s*\)/i)?.[1];

    expect(siteUrl).toBeTruthy();
    expect(seededAudience).toBe(new URL("/mcp", siteUrl).toString());
    expect(seededAudience).toBe("http://127.0.0.1:3100/mcp");
  });

  it("allows only the app callback globally", () => {
    const redirectLine = authSection.match(/^additional_redirect_urls = \[(.*)\]$/m)?.[1] ?? "";
    const redirects = [...redirectLine.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(redirects).toEqual([
      "http://127.0.0.1:3100/auth/callback",
    ]);
  });

  it("enables the exact local OAuth consent and client-registration contract", () => {
    expect(oauthServerSection).toMatch(/^enabled = true$/m);
    expect(oauthServerSection).toMatch(/^authorization_url_path = "\/oauth\/consent"$/m);
    expect(oauthServerSection).toMatch(/^allow_dynamic_registration = true$/m);
  });
});
