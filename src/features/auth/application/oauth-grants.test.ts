import { describe, expect, it, vi } from "vitest";
import { displayOAuthGrantScopes, listUserOAuthGrants, revokeUserOAuthGrant, validateRequestedIdentityScopes } from "./oauth-grants";

describe("user OAuth grants", () => {
  it("lists bounded safe grant fields for the authenticated user", async () => {
    const listGrants = vi.fn().mockResolvedValue({ data: [{ client: { id: "11111111-1111-4111-8111-111111111111", name: "Codex", uri: "https://codex.example", logo_uri: "" }, scopes: ["openid", "email"], granted_at: "2026-08-06T09:00:00Z" }], error: null });
    await expect(listUserOAuthGrants({ auth: { oauth: { listGrants } } } as never)).resolves.toEqual({ status: "loaded", grants: [{ clientId: "11111111-1111-4111-8111-111111111111", clientName: "Codex", scopes: ["openid", "email"], grantedAt: "2026-08-06T09:00:00Z" }] });
  });
  it("revokes only a bounded UUID client id", async () => {
    const revokeGrant = vi.fn().mockResolvedValue({ data: {}, error: null });
    await expect(revokeUserOAuthGrant({ auth: { oauth: { revokeGrant } } } as never, "bad")).resolves.toEqual({ ok: false });
    await expect(revokeUserOAuthGrant({ auth: { oauth: { revokeGrant } } } as never, "11111111-1111-4111-8111-111111111111")).resolves.toEqual({ ok: true });
    expect(revokeGrant).toHaveBeenCalledOnce();
  });
  it("returns safe empty/failure states without surfacing provider errors", async () => {
    await expect(listUserOAuthGrants({ auth: { oauth: { listGrants: vi.fn().mockResolvedValue({ data: null, error: { message: "secret" } }) } } } as never)).resolves.toEqual({ status: "error", grants: [] });
    await expect(revokeUserOAuthGrant({ auth: { oauth: { revokeGrant: vi.fn().mockResolvedValue({ error: { message: "secret" } }) } } } as never, "11111111-1111-4111-8111-111111111111")).resolves.toEqual({ ok: false });
  });

  it("fails closed when consent requests any unsupported scope", () => {
    expect(validateRequestedIdentityScopes("openid email profile")).toEqual(["openid", "email", "profile"]);
    expect(validateRequestedIdentityScopes("openid admin:write")).toBeNull();
    expect(validateRequestedIdentityScopes("   ")).toBeNull();
  });

  it("discloses safe unknown scope names verbatim on an existing grant", async () => {
    const listGrants = vi.fn().mockResolvedValue({ data: [{ client: { id: "11111111-1111-4111-8111-111111111111", name: "Claude" }, scopes: ["openid", "admin:write"], granted_at: "2026-08-06T09:00:00Z" }], error: null });
    const result = await listUserOAuthGrants({ auth: { oauth: { listGrants } } } as never);
    expect(result.grants[0].scopes).toEqual(["openid", "admin:write"]);
  });

  it.each([
    ["control character", "admin\nwrite"],
    ["markup", "<script>alert(1)</script>"],
    ["quote", "admin\"write"],
    ["backslash", "admin\\write"],
    ["overlong", `read:${"a".repeat(100)}`],
  ])("redacts an unsafe %s scope without reflecting it", (_label, unsafe) => {
    const displayed = displayOAuthGrantScopes(["openid", unsafe]);
    expect(displayed).toEqual(["openid", "Invalid scope (redacted)"]);
    expect(displayed.join(" ")).not.toContain(unsafe);
    expect(displayed.join(" ")).not.toMatch(/[<>"'`\\\u0000-\u001f\u007f]/);
  });

  it("caps the rendered scope count and discloses how many were omitted", () => {
    const scopes = Array.from({ length: 25 }, (_value, index) => `resource:${index}`);
    const displayed = displayOAuthGrantScopes(scopes);
    expect(displayed).toHaveLength(21);
    expect(displayed.slice(0, 20)).toEqual(scopes.slice(0, 20));
    expect(displayed[20]).toBe("5 more scopes omitted");
  });
});
