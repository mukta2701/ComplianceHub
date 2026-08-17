import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const hoisted = vi.hoisted(() => ({
  context: { organisation: { id: "11111111-1111-4111-8111-111111111111" }, user: { id: "22222222-2222-4222-8222-222222222222" }, membership: { role: "owner" } },
  cookieSet: vi.fn(),
  insert: vi.fn(),
  enforceRateLimit: vi.fn(),
  createOAuthFlow: vi.fn(),
  requireContext: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ set: hoisted.cookieSet }) }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ from: () => ({ insert: hoisted.insert }) }),
}));
vi.mock("@/features/github/application/github-user-oauth", () => ({
  createOAuthFlow: hoisted.createOAuthFlow,
  buildGitHubAuthorizeUrl: () => new URL("https://github.com/login/oauth/authorize?safe=1"),
}));

import { GET } from "./route";

describe("GET /api/github/setup", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://compliance.example");
    vi.stubEnv("GITHUB_APP_SLUG", "compliancehub-app");
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "client-id");
    vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GITHUB_ALLOWED_ACCOUNT_ID", "99");
    hoisted.context = { organisation: { id: ORG_ID }, user: { id: ACTOR_ID }, membership: { role: "owner" } };
    hoisted.cookieSet.mockReset();
    hoisted.insert.mockReset().mockResolvedValue({ error: null });
    hoisted.enforceRateLimit.mockReset().mockResolvedValue(undefined);
    hoisted.createOAuthFlow.mockReset().mockReturnValue({
      state: "state", stateHash: "a".repeat(64), codeVerifier: "v".repeat(43),
      codeChallenge: "challenge", cookieValue: "signed-cookie", expiresAt: "2026-08-17T12:10:00.000Z",
    });
    hoisted.requireContext.mockReset().mockImplementation(() => Promise.resolve(hoisted.context));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects non-operators without writing state", async () => {
    hoisted.context.membership.role = "member";
    const response = await GET(new Request("https://hostile.example/api/github/setup"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://compliance.example/app/integrations?github=not_authorized");
    expect(hoisted.insert).not.toHaveBeenCalled();
  });

  it("maps unauthenticated context resolution to a canonical 303 sign-in redirect", async () => {
    hoisted.requireContext.mockRejectedValue(new Error("NEXT_REDIRECT credential detail"));
    const response = await GET(new Request("https://hostile.example/api/github/setup"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://compliance.example/sign-in");
    expect(hoisted.insert).not.toHaveBeenCalled();
  });

  it("redirects an operator without an installation only to the configured app install page", async () => {
    const response = await GET(new Request("https://hostile.example/api/github/setup"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://github.com/apps/compliancehub-app/installations/new");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(hoisted.cookieSet).not.toHaveBeenCalled();
  });

  it("stores only the state hash and complete binding before setting the strict flow cookie", async () => {
    const response = await GET(new Request("https://hostile.example/api/github/setup?installation_id=77&setup_action=install"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://github.com/login/oauth/authorize?safe=1");
    expect(hoisted.insert).toHaveBeenCalledWith({
      organisation_id: ORG_ID, actor_id: ACTOR_ID, pending_provider_installation_id: 77,
      state_hash: "a".repeat(64), expires_at: "2026-08-17T12:10:00.000Z",
    });
    expect(hoisted.cookieSet).toHaveBeenCalledWith("compliancehub_github_oauth", "signed-cookie", {
      httpOnly: true, secure: true, sameSite: "lax", path: "/api/github", maxAge: 600,
    });
  });

  it.each([
    "?installation_id=77&installation_id=78",
    "?installation_id=0",
    "?installation_id=not-a-number",
    "?unexpected=1",
  ])("rejects malformed or duplicate query input %s", async (query) => {
    const response = await GET(new Request(`https://hostile.example/api/github/setup${query}`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://compliance.example/app/integrations?github=invalid_request");
    expect(hoisted.insert).not.toHaveBeenCalled();
  });
});
