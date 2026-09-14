import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  buildGitHubAuthorizeUrl,
  collectUserInstallationRepositories,
  createOAuthFlow,
  exchangeGitHubUserCode,
  getAppInstallation,
  listUserInstallationIds,
  MAX_DISCOVERED_REPOSITORIES,
  MAX_GITHUB_DISCOVERY_PAGES,
  parseOAuthFlowCookie,
} from "./github-user-oauth";

const binding = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  pendingInstallationId: 77,
};
const TEST_MAC_INPUT = ["unit", "fixture", "mac", "input"].join(":");
const TEST_USER_CREDENTIAL = ["unit", "fixture", "credential"].join(":");

function repository(id: number) {
  return {
    id,
    owner: { login: "Adtecher" },
    name: `repo-${id}`,
    full_name: `Adtecher/repo-${id}`,
    html_url: `https://github.com/Adtecher/repo-${id}`,
    visibility: "private",
    archived: false,
    default_branch: "main",
  };
}

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

  it("reads app installation metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 77, account: { id: 99, login: "Adtecher", type: "Organization" },
      repository_selection: "selected", permissions: { metadata: "read" }, suspended_at: null,
    })));
    await expect(getAppInstallation({ appJwt: "jwt", installationId: 77, fetchImpl })).resolves.toMatchObject({ id: 77, repositorySelection: "selected" });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });

  it("collects one stable 201-repository inventory over three trusted pages", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 201,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2&per_page=1>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 201,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 101)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=3>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 201,
        repositories: [repository(201)],
      })));

    const repositories = await collectUserInstallationRepositories({
      userToken: TEST_USER_CREDENTIAL,
      installationId: 77,
      fetchImpl,
    });

    expect(repositories).toHaveLength(201);
    expect(repositories[0]).toMatchObject({ id: 1, fullName: "Adtecher/repo-1" });
    expect(repositories[200]).toMatchObject({ id: 201, fullName: "Adtecher/repo-201" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/user/installations/77/repositories?per_page=100",
      "https://api.github.com/user/installations/77/repositories?page=2&per_page=100",
      "https://api.github.com/user/installations/77/repositories?page=3&per_page=100",
    ]);
    expect(fetchImpl.mock.calls.every((call) => (call[1] as RequestInit).redirect === "error")).toBe(true);
  });

  it("rejects a hostile repository pagination origin before sending the user token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      total_count: 101,
      repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
    }), { headers: { Link: '<https://attacker.example/steal?page=2>; rel="next"' } }));

    await expect(collectUserInstallationRepositories({ userToken: TEST_USER_CREDENTIAL, installationId: 77, fetchImpl }))
      .rejects.toThrow("GitHub verification failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated repository page without replaying it", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 201,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 201,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 101)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2>; rel="next"' } }));

    await expect(collectUserInstallationRepositories({ userToken: TEST_USER_CREDENTIAL, installationId: 77, fetchImpl }))
      .rejects.toThrow("GitHub verification failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a logical repository page replay hidden behind a distinct URL", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 300,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2&cursor=first>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 300,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 101)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?cursor=second&page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 300,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 201)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=3>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 300, repositories: [] })));

    await expect(collectUserInstallationRepositories({
      userToken: TEST_USER_CREDENTIAL,
      installationId: 77,
      fetchImpl,
    })).rejects.toThrow("GitHub verification failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate repository IDs across pages", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 101,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, repositories: [repository(100)] })));

    await expect(collectUserInstallationRepositories({ userToken: TEST_USER_CREDENTIAL, installationId: 77, fetchImpl }))
      .rejects.toThrow("GitHub verification failed");
  });

  it("rejects a changed repository total", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 101,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 102, repositories: [repository(101)] })));

    await expect(collectUserInstallationRepositories({ userToken: TEST_USER_CREDENTIAL, installationId: 77, fetchImpl }))
      .rejects.toThrow("GitHub verification failed");
  });

  it("rejects a partial intermediate page and a missing final repository", async () => {
    const partialPage = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      total_count: 101,
      repositories: [repository(1)],
    }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2>; rel="next"' } }));
    await expect(collectUserInstallationRepositories({ userToken: TEST_USER_CREDENTIAL, installationId: 77, fetchImpl: partialPage }))
      .rejects.toThrow("GitHub verification failed");
    expect(partialPage).toHaveBeenCalledTimes(1);

    const missingFinal = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 101,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, repositories: [] })));
    await expect(collectUserInstallationRepositories({ userToken: TEST_USER_CREDENTIAL, installationId: 77, fetchImpl: missingFinal }))
      .rejects.toThrow("GitHub verification failed");
  });

  it("enforces the exact 100-page and 10,000-repository discovery bounds", async () => {
    expect(MAX_GITHUB_DISCOVERY_PAGES).toBe(100);
    expect(MAX_DISCOVERED_REPOSITORIES).toBe(10_000);

    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      total_count: 10_001,
      repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
    }), { headers: { Link: '<https://api.github.com/user/installations/77/repositories?page=2>; rel="next"' } }));
    await expect(collectUserInstallationRepositories({ userToken: TEST_USER_CREDENTIAL, installationId: 77, fetchImpl }))
      .rejects.toThrow("GitHub verification failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
