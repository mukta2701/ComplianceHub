import { describe, expect, it } from "vitest";
import { safePostAuthPath } from "./auth-destination";

const RAW_INVITATION_VALUE = "A".repeat(43);

describe("safePostAuthPath", () => {
  it.each([
    `/invite?token=${RAW_INVITATION_VALUE}`,
    `/invite#${RAW_INVITATION_VALUE}`,
    "/invite?status=anything#fragment",
  ])("canonicalizes an invite continuation with query/hash to literal /invite", (candidate) => {
    const destination = safePostAuthPath(candidate);

    expect(destination).toBe("/invite");
    expect(destination).not.toContain(RAW_INVITATION_VALUE);
  });

  it("continues to preserve approved application query parameters", () => {
    expect(safePostAuthPath("/app/policies?state=draft#comments")).toBe("/app/policies?state=draft#comments");
  });

  it("preserves only a canonical OAuth consent continuation when explicitly enabled", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(safePostAuthPath(`/oauth/consent?authorization_id=${id}`, { allowOAuthConsent: true }))
      .toBe(`/oauth/consent?authorization_id=${id}`);
  });

  it("preserves a bounded opaque Supabase OAuth authorization id", () => {
    const id = "elvrapg4j3ab5gvtp4zyya7qi3e6mrhg";
    expect(safePostAuthPath(`/oauth/consent?authorization_id=${id}`, { allowOAuthConsent: true }))
      .toBe(`/oauth/consent?authorization_id=${id}`);
  });

  it.each([
    "/oauth/consent", "/oauth/consent?authorization_id=bad", "/oauth/consent?authorization_id=11111111-1111-4111-8111-111111111111&extra=1",
    "/oauth/consent?authorization_id=11111111-1111-4111-8111-111111111111#fragment",
  ])("rejects a non-canonical OAuth continuation %s", (candidate) => {
    expect(safePostAuthPath(candidate, { allowOAuthConsent: true })).toBe("/app");
  });
});
