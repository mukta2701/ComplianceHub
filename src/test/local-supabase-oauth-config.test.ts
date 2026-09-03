import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
const authSection = config.match(/^\[auth\]\n([\s\S]*?)(?=^\[|\Z)/m)?.[1] ?? "";
const oauthServerSection = config.match(/^\[auth\.oauth_server\]\n([\s\S]*?)(?=^\[|\Z)/m)?.[1] ?? "";

describe("local Supabase OAuth configuration", () => {
  it("uses the local ComplianceHub origin for OAuth consent", () => {
    expect(authSection).toMatch(/^site_url = "http:\/\/127\.0\.0\.1:3100"$/m);
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
