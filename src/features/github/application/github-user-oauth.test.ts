import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  buildGitHubAuthorizeUrl,
  collectUserInstallationRepositories,
  createOAuthFlow,
  exchangeGitHubUserCode,
  getAppInstallation,
  listUserInstallationIds,
  parseOAuthFlowCookie,
} from "./github-user-oauth";

const binding = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  pendingInstallationId: 77,
};
const TEST_MAC_INPUT = ["unit", "fixture", "mac", "input"].join(":");

describe("GitHub user OAuth", () => {
  it("creates a signed ten-minute state and S256 PKCE flow", () => {
    const flow = createOAuthFlow({
      ...binding,
      clientSecret: TEST_MAC_INPUT,
      now: new Date("2026-08-17T12:00:00.000Z"),
      randomBytes: () => Buffer.alloc(32, 7),
    });

    expect(flow.state).toBe(Buffer.alloc(32, 7).toString("base64url"));
    expect(flow.stateHash).toBe(createHash("sha256").update(flow.state).digest("hex"));
    expect(flow.codeChallenge).toBe(createHash("sha256").update(flow.codeVerifier).digest("base64url"));
    expect(flow.expiresAt).toBe("2026-08-17T12:10:00.000Z");
    expect(parseOAuthFlowCookie(flow.cookieValue, TEST_MAC_INPUT, new Date("2026-08-17T12:09:59.000Z"))).toMatchObject(binding);
  });

  it("rejects tampered, expired, oversized, and version-mismatched cookies", () => {
    const flow = createOAuthFlow({ ...binding, clientSecret: TEST_MAC_INPUT, now: new Date("2026-08-17T12:00:00Z") });
    const [payload, signature] = flow.cookieValue.split(".");
    expect(() => parseOAuthFlowCookie(`${payload}.${signature}x`, TEST_MAC_INPUT, new Date("2026-08-17T12:01:00Z"))).toThrow("Invalid GitHub OAuth flow");
    expect(() => parseOAuthFlowCookie(flow.cookieValue, TEST_MAC_INPUT, new Date("2026-08-17T12:10:00Z"))).toThrow("Invalid GitHub OAuth flow");
    expect(() => parseOAuthFlowCookie("x".repeat(4097), TEST_MAC_INPUT, new Date())).toThrow("Invalid GitHub OAuth flow");
    const decoded = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const wrongVersion = Buffer.from(JSON.stringify({ ...decoded, v: 2 })).toString("base64url");
    const key = createHmac("sha256", TEST_MAC_INPUT).update("compliancehub:github-oauth-flow-cookie:mac-key:v1").digest();
    const validWrongVersionSignature = createHmac("sha256", key).update(wrongVersion).digest("base64url");
    expect(() => parseOAuthFlowCookie(`${wrongVersion}.${validWrongVersionSignature}`, TEST_MAC_INPUT, new Date("2026-08-17T12:01:00Z"))).toThrow("Invalid GitHub OAuth flow");
  });

  it("builds an exact authorize URL without signup", () => {
    const url = buildGitHubAuthorizeUrl({
      clientId: "Iv1.example",
      callbackUrl: "https://compliance.example/api/github/callback",
      state: "state-value",
      codeChallenge: "challenge-value",
    });
    expect(url.toString()).toBe("https://github.com/login/oauth/authorize?client_id=Iv1.example&redirect_uri=https%3A%2F%2Fcompliance.example%2Fapi%2Fgithub%2Fcallback&state=state-value&code_challenge=challenge-value&code_challenge_method=S256&allow_signup=false&prompt=select_account");
  });

  it("exchanges a code using PKCE and safe fetch options", async () => {
    const issuedAuthorization = crypto.randomUUID();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: issuedAuthorization,
      token_type: "bearer",
      scope: "read:user",
    }), { status: 200 }));
    const authorization = await exchangeGitHubUserCode({
      clientId: "client", clientSecret: TEST_MAC_INPUT, code: "code-value",
      callbackUrl: "https://compliance.example/api/github/callback", codeVerifier: "v".repeat(43), fetchImpl,
    });
    expect(authorization).toBe(issuedAuthorization);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(fetchImpl.mock.calls[0][0]).toBe("https://github.com/login/oauth/access_token");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(String(init.body)).toContain("code_verifier=");
    expect(String(init.body)).not.toContain("undefined");
  });

  it("never includes provider response details in exchange errors", async () => {
    const providerDetail = crypto.randomUUID();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(providerDetail, { status: 400 }));
    const error = await exchangeGitHubUserCode({
      clientId: "client", clientSecret: TEST_MAC_INPUT, code: "code-value",
      callbackUrl: "https://compliance.example/api/github/callback", codeVerifier: "v".repeat(43), fetchImpl,
    }).catch((value: unknown) => value);
    expect(String(error)).not.toContain(providerDetail);
    expect(String(error)).not.toContain("code-value");
  });

  it("lists user installation IDs with trusted bounded pagination", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 2, installations: [{ id: 77 }] }), {
        headers: { Link: '<https://api.github.com/user/installations?page=2>; rel="next"' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 2, installations: [{ id: 88 }] })));
    await expect(listUserInstallationIds({ userToken: crypto.randomUUID(), fetchImpl })).resolves.toEqual([77, 88]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });

  it("rejects a hostile pagination origin", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ total_count: 2, installations: [{ id: 77 }] }), {
      headers: { Link: '<https://attacker.example/steal>; rel="next"' },
    }));
    await expect(listUserInstallationIds({ userToken: crypto.randomUUID(), fetchImpl })).rejects.toThrow("GitHub verification failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects truncated or duplicate user installation inventories", async () => {
    for (const body of [
      { total_count: 2, installations: [{ id: 77 }] },
      { total_count: 2, installations: [{ id: 77 }, { id: 77 }] },
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(listUserInstallationIds({ userToken: crypto.randomUUID(), fetchImpl })).rejects.toThrow("GitHub verification failed");
    }
  });

  it("reads app installation metadata and requires a selected inventory of at most 100", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 77, account: { id: 99, login: "Adtecher", type: "Organization" },
        repository_selection: "selected", permissions: { metadata: "read" }, suspended_at: null,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 1, repositories: [{
        id: 101, owner: { login: "Adtecher" }, name: "portal", full_name: "Adtecher/portal",
        html_url: "https://github.com/Adtecher/portal", visibility: "private", archived: false, default_branch: "main",
      }] })));
    await expect(getAppInstallation({ appJwt: "jwt", installationId: 77, fetchImpl })).resolves.toMatchObject({ id: 77, repositorySelection: "selected" });
    await expect(collectUserInstallationRepositories({ userToken: "user", installationId: 77, fetchImpl })).resolves.toHaveLength(1);
    expect(fetchImpl.mock.calls.every((call) => (call[1] as RequestInit).redirect === "error")).toBe(true);
  });

  it("rejects inventories that are truncated, exceed 100, or contain duplicate repository IDs", async () => {
    const repository = { id: 101, owner: { login: "Adtecher" }, name: "portal", full_name: "Adtecher/portal", html_url: "https://github.com/Adtecher/portal", visibility: "private", archived: false, default_branch: "main" };
    for (const body of [
      { total_count: 101, repositories: [repository] },
      { total_count: 2, repositories: [repository, repository] },
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(collectUserInstallationRepositories({ userToken: "user", installationId: 77, fetchImpl })).rejects.toThrow("GitHub verification failed");
    }
  });
});
