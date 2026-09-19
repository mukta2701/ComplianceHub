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

  it("reads app installation metadata", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 77, account: { id: 99, login: "Adtecher", type: "Organization" },
        repository_selection: "selected", permissions: { metadata: "read" }, suspended_at: null,
      })));
    await expect(getAppInstallation({ appJwt: "jwt", installationId: 77, fetchImpl })).resolves.toMatchObject({ id: 77, repositorySelection: "selected" });
    expect(fetchImpl.mock.calls.every((call) => (call[1] as RequestInit).redirect === "error")).toBe(true);
  });
});

function discoveryRepository(id: number) {
  return {
    id, owner: { login: "Adtecher" }, name: `repo-${id}`, full_name: `Adtecher/repo-${id}`,
    html_url: `https://github.com/Adtecher/repo-${id}`, visibility: "private",
    archived: false, default_branch: "main",
  };
}

function discoveryPage(ids: number[], total: number, next?: string) {
  return new Response(JSON.stringify({ total_count: total, repositories: ids.map(discoveryRepository) }), {
    headers: next ? { Link: `<${next}>; rel="next"` } : {},
  });
}

function rangeIds(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

describe("complete repository discovery", () => {
  it("follows three trusted pages and returns 201 repositories with per_page forced", async () => {
    const userToken = crypto.randomUUID();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(discoveryPage(rangeIds(1, 100), 201, "https://api.github.com/user/installations/77/repositories?page=2"))
      .mockResolvedValueOnce(discoveryPage(rangeIds(101, 200), 201, "https://api.github.com/user/installations/77/repositories?page=3"))
      .mockResolvedValueOnce(discoveryPage([201], 201));
    const repositories = await collectUserInstallationRepositories({ userToken, installationId: 77, fetchImpl });
    expect(repositories).toHaveLength(201);
    expect(repositories[0]?.id).toBe(1);
    expect(repositories[200]?.id).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const call of fetchImpl.mock.calls) {
      expect(new URL(call[0] as string).searchParams.get("per_page")).toBe("100");
      expect((call[1] as RequestInit).redirect).toBe("error");
    }
    expect(JSON.stringify(repositories)).not.toContain(userToken);
  });

  it("rejects a hostile pagination origin after one request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(discoveryPage([101], 2, "https://attacker.example/steal"));
    await expect(collectUserInstallationRepositories({ userToken: crypto.randomUUID(), installationId: 77, fetchImpl })).rejects.toThrow("GitHub verification failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated page, duplicate IDs, a changed total, and missing final rows", async () => {
    const twoPages = (first: Response, second: Response) => vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const cases: Array<[string, () => unknown]> = [
      ["repeated page", () => twoPages(
        discoveryPage(rangeIds(1, 100), 200, "https://api.github.com/user/installations/77/repositories?page=2"),
        discoveryPage(rangeIds(1, 100), 200),
      )],
      ["duplicate ID across pages", () => twoPages(
        discoveryPage(rangeIds(1, 100), 150, "https://api.github.com/user/installations/77/repositories?page=2"),
        discoveryPage(rangeIds(100, 149), 150),
      )],
      ["changed total", () => twoPages(
        discoveryPage(rangeIds(1, 100), 150, "https://api.github.com/user/installations/77/repositories?page=2"),
        discoveryPage(rangeIds(101, 150), 999),
      )],
      ["missing final row", () => twoPages(
        discoveryPage(rangeIds(1, 100), 201, "https://api.github.com/user/installations/77/repositories?page=2"),
        discoveryPage(rangeIds(101, 200), 201),
      )],
      ["truncated single page", () => vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ total_count: 101, repositories: [discoveryRepository(101)] })),
      )],
      ["duplicate single page", () => vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ total_count: 2, repositories: [discoveryRepository(101), discoveryRepository(101)] })),
      )],
    ];
    for (const [label, makeFetch] of cases) {
      await expect(
        collectUserInstallationRepositories({ userToken: crypto.randomUUID(), installationId: 77, fetchImpl: makeFetch() as typeof fetch }),
        label,
      ).rejects.toThrow("GitHub verification failed");
    }
  });

  it("rejects inventories beyond 100 pages or 10,000 repositories", async () => {
    const overTotal = vi.fn().mockResolvedValue(discoveryPage(rangeIds(1, 100), 10_001, "https://api.github.com/user/installations/77/repositories?page=2"));
    await expect(collectUserInstallationRepositories({ userToken: crypto.randomUUID(), installationId: 77, fetchImpl: overTotal })).rejects.toThrow("GitHub verification failed");
    const pageOf = (page: number) => discoveryPage(
      rangeIds((page - 1) * 100 + 1, page * 100),
      10_100,
      page < 101 ? `https://api.github.com/user/installations/77/repositories?page=${page + 1}` : undefined,
    );
    const manyPages = vi.fn().mockImplementation((url: string) => {
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return Promise.resolve(pageOf(page));
    });
    await expect(collectUserInstallationRepositories({ userToken: crypto.randomUUID(), installationId: 77, fetchImpl: manyPages })).rejects.toThrow("GitHub verification failed");
    expect(manyPages.mock.calls.length).toBeLessThanOrEqual(100);
  });

  it("accepts exactly 10,000 repositories across 100 pages", async () => {
    const pageOf = (page: number) => discoveryPage(
      rangeIds((page - 1) * 100 + 1, page * 100),
      10_000,
      page < 100 ? `https://api.github.com/user/installations/77/repositories?page=${page + 1}` : undefined,
    );
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return Promise.resolve(pageOf(page));
    });
    const repositories = await collectUserInstallationRepositories({ userToken: crypto.randomUUID(), installationId: 77, fetchImpl });
    expect(repositories).toHaveLength(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(100);
  });
});
