import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  context: {
    user: { id: "96000000-0000-4000-8000-000000000001" },
    organisation: { id: "96000000-0000-4000-8000-000000000002", name: "Acme" },
    membership: { role: "owner" },
  },
  issueState: vi.fn(),
  getConfig: vi.fn(),
  buildUrl: vi.fn(),
  enforceRateLimit: vi.fn(),
  service: { service: true },
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: vi.fn(async () => hoisted.context) }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://compliance.example" }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => hoisted.service }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/features/integrations/application/provider-config", () => ({
  getJiraProviderConfig: hoisted.getConfig,
}));
vi.mock("@/features/integrations/application/authorization-state", () => ({
  issueAuthorizationState: hoisted.issueState,
}));
vi.mock("@/features/integrations/application/jira-oauth", () => ({
  buildJiraAuthorizationUrl: hoisted.buildUrl,
}));

import { GET } from "./route";

const clientFixture = ["synthetic", "client", "fixture"].join("-");

describe("GET /api/integrations/jira/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.context.membership.role = "owner";
    hoisted.enforceRateLimit.mockResolvedValue(undefined);
    hoisted.getConfig.mockReturnValue({
      clientId: "jira-client",
      clientSecret: clientFixture,
      callbackUrl: "https://compliance.example/api/integrations/jira/callback",
    });
    hoisted.issueState.mockResolvedValue({ state: "a".repeat(43), expiresAt: "2026-07-14T12:10:00Z" });
    hoisted.buildUrl.mockReturnValue("https://auth.atlassian.com/authorize?safe=request");
  });

  it.each(["owner", "admin"])("redirects a current %s to Atlassian consent", async (role) => {
    hoisted.context.membership.role = role;
    const response = await GET();

    expect(response.headers.get("location")).toBe("https://auth.atlassian.com/authorize?safe=request");
    expect(hoisted.issueState).toHaveBeenCalledWith(expect.objectContaining({
      database: hoisted.service,
      provider: "jira",
      purpose: "jira_oauth",
    }));
    expect(hoisted.buildUrl).toHaveBeenCalledWith(hoisted.getConfig.mock.results[0].value, "a".repeat(43));
  });

  it("forbids a member before rate limiting or minting state", async () => {
    hoisted.context.membership.role = "member";
    const response = await GET();

    expect(response.status).toBe(403);
    expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
    expect(hoisted.issueState).not.toHaveBeenCalled();
  });

  it("rate limits before configuration lookup and state persistence", async () => {
    hoisted.enforceRateLimit.mockRejectedValue(new Error("raw limiter detail"));
    const response = await GET();

    expect(response.status).toBe(429);
    expect(await response.text()).toBe("Too many connection attempts. Please wait and try again.");
    expect(hoisted.getConfig).not.toHaveBeenCalled();
    expect(hoisted.issueState).not.toHaveBeenCalled();
  });

  it("redirects safely when Jira credentials are not configured", async () => {
    hoisted.getConfig.mockImplementation(() => { throw new Error("client secret missing"); });
    const response = await GET();

    expect(response.headers.get("location")).toBe(
      "https://compliance.example/app/integrations?jira=setup-required",
    );
    expect(hoisted.issueState).not.toHaveBeenCalled();
  });
});
