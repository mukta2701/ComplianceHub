import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ client: { auth: {
  getUser: vi.fn(), oauth: { getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn() },
} } }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => Promise.resolve(hoisted.client) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { oauthConsentAction } from "./actions";

const authorizationId = "11111111-1111-4111-8111-111111111111";
const details = { authorization_id: authorizationId, redirect_uri: "https://client.example/callback", client: { id: "22222222-2222-4222-8222-222222222222", name: "Codex", uri: "https://client.example", logo_uri: "" }, user: { id: "u", email: "u@example.test" }, scope: "openid email profile" };

function form(decision = "approve", id = authorizationId) { const value = new FormData(); value.set("decision", decision); value.set("authorizationId", id); return value; }

describe("oauthConsentAction", () => {
  beforeEach(() => {
    hoisted.client.auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u" } } });
    hoisted.client.auth.oauth.getAuthorizationDetails.mockReset().mockResolvedValue({ data: details, error: null });
    hoisted.client.auth.oauth.approveAuthorization.mockReset().mockResolvedValue({ data: { redirect_url: "https://client.example/callback?code=sensitive" }, error: null });
    hoisted.client.auth.oauth.denyAuthorization.mockReset().mockResolvedValue({ data: { redirect_url: "https://client.example/callback?error=access_denied" }, error: null });
  });

  it("requires an authenticated user", async () => {
    hoisted.client.auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(oauthConsentAction(form())).rejects.toThrow(`REDIRECT:/sign-in?next=%2Foauth%2Fconsent%3Fauthorization_id%3D${authorizationId}`);
  });
  it.each(["", "bad", "A".repeat(300)])("rejects an invalid authorization id", async (id) => {
    await expect(oauthConsentAction(form("approve", id))).rejects.toThrow("REDIRECT:/oauth/consent?message=That+authorization+request+is+invalid+or+expired.");
  });
  it.each(["approve", "deny"])("submits an explicit %s decision", async (decision) => {
    await expect(oauthConsentAction(form(decision))).rejects.toThrow(/^REDIRECT:https:\/\/client\.example\/callback/);
    const method = decision === "approve" ? hoisted.client.auth.oauth.approveAuthorization : hoisted.client.auth.oauth.denyAuthorization;
    expect(method).toHaveBeenCalledWith(authorizationId, { skipBrowserRedirect: true });
  });
  it("approves the exact identity and offline refresh scope set", async () => {
    hoisted.client.auth.oauth.getAuthorizationDetails.mockResolvedValue({ data: { ...details, scope: "openid profile email offline_access" }, error: null });
    await expect(oauthConsentAction(form("approve"))).rejects.toThrow(/^REDIRECT:https:\/\/client\.example\/callback/);
    expect(hoisted.client.auth.oauth.approveAuthorization).toHaveBeenCalledWith(authorizationId, { skipBrowserRedirect: true });
  });
  it("submits a bounded opaque Supabase authorization id", async () => {
    const opaqueId = "elvrapg4j3ab5gvtp4zyya7qi3e6mrhg";
    await expect(oauthConsentAction(form("approve", opaqueId))).rejects.toThrow(/^REDIRECT:https:\/\/client\.example\/callback/);
    expect(hoisted.client.auth.oauth.approveAuthorization).toHaveBeenCalledWith(opaqueId, { skipBrowserRedirect: true });
  });
  it("rejects a redirect that does not match the registered client origin", async () => {
    hoisted.client.auth.oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: "https://evil.example/steal" }, error: null });
    await expect(oauthConsentAction(form())).rejects.toThrow("REDIRECT:/oauth/consent?message=Could+not+complete+that+authorization+request.");
  });
  it.each(["phone", "admin:write", "openid profile email offline_access phone"])("fails closed without approving or reflecting unsupported scope request %s", async (scope) => {
    hoisted.client.auth.oauth.getAuthorizationDetails.mockResolvedValue({ data: { ...details, scope }, error: null });
    await expect(oauthConsentAction(form())).rejects.toThrow("REDIRECT:/oauth/consent?message=That+authorization+request+requests+unsupported+access.");
    expect(hoisted.client.auth.oauth.approveAuthorization).not.toHaveBeenCalled();
  });
  it("rejects non-TLS and credentialed redirects", async () => {
    for (const redirect_url of ["http://client.example/callback", "https://user:pass@client.example/callback"]) {
      hoisted.client.auth.oauth.approveAuthorization.mockResolvedValueOnce({ data: { redirect_url }, error: null });
      await expect(oauthConsentAction(form())).rejects.toThrow("REDIRECT:/oauth/consent?message=Could+not+complete+that+authorization+request.");
    }
  });
});
