import { describe, expect, it } from "vitest";
import { parseOAuthConsentSearchParams } from "./oauth-redirect";

describe("parseOAuthConsentSearchParams", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("accepts one bounded authorization id plus an optional safe status message", () => {
    expect(parseOAuthConsentSearchParams({ authorization_id: id })).toEqual({ authorizationId: id });
    const message = "Could not complete that authorization request.";
    expect(parseOAuthConsentSearchParams({ authorization_id: id, message })).toEqual({ authorizationId: id, message });
  });
  it.each([
    {}, { authorization_id: "bad" }, { authorization_id: id, extra: "1" },
    { authorization_id: [id] }, { authorization_id: id, message: "A".repeat(201) }, { authorization_id: id, message: "Click this attacker link" },
  ])("rejects missing, repeated, extra, or unbounded query input", (value) => {
    expect(parseOAuthConsentSearchParams(value)).toBeNull();
  });
});
