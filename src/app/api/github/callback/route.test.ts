import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const REPOSITORY = {
  id: 101,
  owner: "Adtecher",
  name: "pilot",
  fullName: "Adtecher/pilot",
  htmlUrl: "https://github.com/Adtecher/pilot",
  visibility: "private" as const,
  archived: false,
  defaultBranch: "main",
};
const hoisted = vi.hoisted(() => ({
  sequence: [] as string[],
  context: { organisation: { id: "11111111-1111-4111-8111-111111111111" }, user: { id: "22222222-2222-4222-8222-222222222222" }, membership: { role: "admin" } },
  cookieValue: "signed-cookie" as string | undefined,
  cookieSet: vi.fn(),
  rpc: vi.fn(),
  enforceRateLimit: vi.fn(),
  parseFlow: vi.fn(),
  exchange: vi.fn(),
  listIds: vi.fn(),
  getApp: vi.fn(),
  collectRepos: vi.fn(),
  createAppJwt: vi.fn(),
  claim: vi.fn(),
  requireContext: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({
  get: () => hoisted.cookieValue === undefined ? undefined : { value: hoisted.cookieValue },
  set: (...args: unknown[]) => { hoisted.sequence.push("clear-cookie"); hoisted.cookieSet(...args); },
}) }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc: hoisted.rpc }) }));
vi.mock("@/features/github/application/github-user-oauth", () => ({
  parseOAuthFlowCookie: hoisted.parseFlow,
  exchangeGitHubUserCode: hoisted.exchange,
  listUserInstallationIds: hoisted.listIds,
  getAppInstallation: hoisted.getApp,
  collectUserInstallationRepositories: hoisted.collectRepos,
}));
vi.mock("@/features/github/application/github-app-auth", () => ({ createAppJwt: hoisted.createAppJwt }));
vi.mock("@/features/github/application/installation-claim", () => ({ claimInstallation: hoisted.claim }));

import { GET } from "./route";

describe("GET /api/github/callback", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://compliance.example");
    vi.stubEnv("GITHUB_ALLOWED_ACCOUNT_TYPE", undefined);
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "client-id");
    vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "private-key");
    vi.stubEnv("GITHUB_ALLOWED_ACCOUNT_ID", "99");
    hoisted.sequence.length = 0;
    hoisted.context = { organisation: { id: ORG_ID }, user: { id: ACTOR_ID }, membership: { role: "admin" } };
    hoisted.cookieValue = "signed-cookie";
    vi.clearAllMocks();
    hoisted.parseFlow.mockReturnValue({
      v: 1, state: "state-value", codeVerifier: "v".repeat(43), organisationId: ORG_ID,
      actorId: ACTOR_ID, pendingInstallationId: 77, expiresAt: "2026-08-17T12:10:00.000Z",
    });
    hoisted.enforceRateLimit.mockResolvedValue(undefined);
    hoisted.rpc.mockResolvedValue({ data: true, error: null });
    hoisted.exchange.mockResolvedValue(crypto.randomUUID());
    hoisted.listIds.mockResolvedValue([77]);
    hoisted.createAppJwt.mockResolvedValue("app-jwt");
    hoisted.getApp.mockResolvedValue({ id: 77, account: { id: 99, login: "Adtecher", type: "Organization" }, repositorySelection: "selected", permissions: {}, suspendedAt: null });
    hoisted.collectRepos.mockResolvedValue([REPOSITORY]);
    hoisted.claim.mockResolvedValue("installation-uuid");
    hoisted.requireContext.mockImplementation(async () => { hoisted.sequence.push("auth"); return hoisted.context; });
  });
  afterEach(() => vi.unstubAllEnvs());

  const request = (query = "?code=code-value&state=state-value&installation_id=77") => new Request(`https://hostile.example/api/github/callback${query}`);

  it("clears the flow cookie before awaited authentication/provider work and completes the verified claim", async () => {
    const response = await GET(request());
    expect(hoisted.sequence.slice(0, 2)).toEqual(["clear-cookie", "auth"]);
    expect(hoisted.cookieSet).toHaveBeenCalledWith("compliancehub_github_oauth", "", {
      httpOnly: true, secure: true, sameSite: "lax", path: "/api/github", maxAge: 0,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://compliance.example/app/integrations?github=connected");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(hoisted.exchange).toHaveBeenCalledWith(expect.objectContaining({ codeVerifier: "v".repeat(43) }));
    expect(hoisted.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: ORG_ID, actorId: ACTOR_ID, requestedInstallationId: 77,
        userInstallationIds: [77],
        repositories: [REPOSITORY],
      }),
      { allowedAccountType: "Organization" },
    );
  });

  it("completes a verified local personal installation claim", async () => {
    vi.stubEnv("GITHUB_ALLOWED_ACCOUNT_TYPE", "User");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000");
    const appInstallation = {
      id: 77,
      account: { id: 99, login: "mukta2701", type: "User" },
      repositorySelection: "selected",
      permissions: {},
      suspendedAt: null,
    };
    const repositories = [{
      ...REPOSITORY,
      owner: "mukta2701",
      fullName: "mukta2701/pilot",
      htmlUrl: "https://github.com/mukta2701/pilot",
    }];
    hoisted.getApp.mockResolvedValue(appInstallation);
    hoisted.collectRepos.mockResolvedValue(repositories);

    const response = await GET(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/app/integrations?github=connected");
    expect(hoisted.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        appInstallation,
        repositories,
      }),
      { allowedAccountType: "User" },
    );
  });

  it.each([
    ["production User on loopback", "production", "User", "http://127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["test User on hosted HTTPS", "test", "User", "https://compliance.example", "https://compliance.example"],
    ["development User on hosted HTTPS", "development", "User", "https://compliance.example", "https://compliance.example"],
    ["test User on a loopback path", "test", "User", "http://127.0.0.1:3000/path", "http://127.0.0.1:3000"],
    ["unknown account type", "test", "Enterprise", "https://compliance.example", "https://compliance.example"],
  ])("rejects invalid account policy configuration before state consumption for %s", async (
    _label,
    nodeEnv,
    accountType,
    configuredSiteUrl,
    canonicalSiteUrl,
  ) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("GITHUB_ALLOWED_ACCOUNT_TYPE", accountType);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", configuredSiteUrl);

    const response = await GET(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${canonicalSiteUrl}/app/integrations?github=configuration_error`);
    expect(hoisted.rpc).not.toHaveBeenCalled();
    expect(hoisted.exchange).not.toHaveBeenCalled();
    expect(hoisted.createAppJwt).not.toHaveBeenCalled();
    expect(hoisted.listIds).not.toHaveBeenCalled();
    expect(hoisted.getApp).not.toHaveBeenCalled();
    expect(hoisted.collectRepos).not.toHaveBeenCalled();
    expect(hoisted.claim).not.toHaveBeenCalled();
  });

  it.each([
    ["missing cookie", undefined, "?code=code-value&state=state-value&installation_id=77"],
    ["mismatched state", "signed-cookie", "?code=code-value&state=other&installation_id=77"],
    ["duplicate code", "signed-cookie", "?code=a&code=b&state=state-value&installation_id=77"],
    ["duplicate installation", "signed-cookie", "?code=a&state=state-value&installation_id=77&installation_id=77"],
  ])("rejects %s before token exchange", async (_label, cookie, query) => {
    hoisted.cookieValue = cookie;
    const response = await GET(request(query));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://compliance.example/app/integrations?github=invalid_request");
    expect(hoisted.exchange).not.toHaveBeenCalled();
    expect(hoisted.sequence[0]).toBe("clear-cookie");
  });

  it("rejects changed or demoted actor/workspace before consuming state", async () => {
    hoisted.context.membership.role = "member";
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("https://compliance.example/app/integrations?github=not_authorized");
    expect(hoisted.rpc).not.toHaveBeenCalled();
    expect(hoisted.exchange).not.toHaveBeenCalled();
  });

  it("clears the cookie and maps unauthenticated callbacks to canonical sign-in", async () => {
    hoisted.requireContext.mockImplementation(async () => { hoisted.sequence.push("auth"); throw new Error("NEXT_REDIRECT detail"); });
    const response = await GET(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://compliance.example/sign-in");
    expect(hoisted.sequence.slice(0, 2)).toEqual(["clear-cookie", "auth"]);
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it("allows only one parallel callback to consume the state before exchange", async () => {
    hoisted.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    const responses = await Promise.all([GET(request()), GET(request())]);
    expect(responses.map((response) => response.headers.get("location")).sort()).toEqual([
      "https://compliance.example/app/integrations?github=connected",
      "https://compliance.example/app/integrations?github=invalid_request",
    ].sort());
    expect(hoisted.exchange).toHaveBeenCalledTimes(1);
  });

  it("returns only fixed errors without leaking provider credentials", async () => {
    const providerDetail = crypto.randomUUID();
    hoisted.exchange.mockRejectedValue(new Error(providerDetail));
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("https://compliance.example/app/integrations?github=verification_failed");
    expect(await response.text()).not.toContain(providerDetail);
  });
});
