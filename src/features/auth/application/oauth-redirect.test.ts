import { describe, expect, it, vi } from "vitest";
import { parseOAuthConsentSearchParams, safeClientRedirect } from "./oauth-redirect";

describe("parseOAuthConsentSearchParams", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("accepts one bounded authorization id plus an optional safe status message", () => {
    expect(parseOAuthConsentSearchParams({ authorization_id: id })).toEqual({ authorizationId: id });
    const message = "Could not complete that authorization request.";
    expect(parseOAuthConsentSearchParams({ authorization_id: id, message })).toEqual({ authorizationId: id, message });
  });
  it("accepts an allowlisted terminal message without an authorization id", () => {
    expect(parseOAuthConsentSearchParams({ message: "Could not complete that authorization request." }))
      .toEqual({ message: "Could not complete that authorization request." });
  });
  it.each([
    {}, { authorization_id: "bad" }, { authorization_id: id, extra: "1" },
    { authorization_id: [id] }, { authorization_id: id, message: "A".repeat(201) }, { authorization_id: id, message: "Click this attacker link" },
  ])("rejects missing, repeated, extra, or unbounded query input", (value) => {
    expect(parseOAuthConsentSearchParams(value)).toBeNull();
  });
  it("permits only the exact registered loopback HTTP callback in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(safeClientRedirect("http://127.0.0.1:4312/callback?code=x", "http://127.0.0.1:4312/callback"))
        .toBe("http://127.0.0.1:4312/callback?code=x");
      expect(safeClientRedirect("http://evil.example/callback?code=x", "http://evil.example/callback")).toBeNull();
      expect(safeClientRedirect("http://127.0.0.1:9999/callback?code=x", "http://127.0.0.1:4312/callback")).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });
});
