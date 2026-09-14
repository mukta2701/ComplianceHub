import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  context: {
    user: { id: "97000000-0000-4000-8000-000000000001" },
    organisation: { id: "97000000-0000-4000-8000-000000000002", name: "Acme" },
    membership: { role: "owner" },
  },
  consumeState: vi.fn(),
  complete: vi.fn(),
  getConfig: vi.fn(),
  createGateway: vi.fn(),
  createStore: vi.fn(),
  gateway: { gateway: true },
  store: { store: true },
  service: { service: true },
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: vi.fn(async () => hoisted.context) }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://compliance.example" }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => hoisted.service }));
vi.mock("@/features/integrations/application/provider-config", () => ({ getJiraProviderConfig: hoisted.getConfig }));
vi.mock("@/features/integrations/application/authorization-state", () => ({ consumeAuthorizationState: hoisted.consumeState }));
vi.mock("@/features/integrations/application/jira-oauth", () => ({
  completeJiraAuthorization: hoisted.complete,
  createJiraOAuthGateway: hoisted.createGateway,
}));
vi.mock("@/features/integrations/application/jira-token-store", () => ({
  createSupabaseJiraConnectionStore: hoisted.createStore,
}));

import { GET } from "./route";

const clientFixture = ["synthetic", "client", "fixture"].join("-");

function callbackUrl(params = new URLSearchParams({ state: "a".repeat(43), code: "one-time-code" })) {
  return `https://compliance.example/api/integrations/jira/callback?${params}`;
}

describe("GET /api/integrations/jira/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.context.membership.role = "owner";
    hoisted.getConfig.mockReturnValue({
      clientId: "jira-client",
      clientSecret: clientFixture,
      callbackUrl: "https://compliance.example/api/integrations/jira/callback",
    });
    hoisted.consumeState.mockResolvedValue({ provider: "jira", purpose: "jira_oauth", continuation: {} });
    hoisted.createGateway.mockReturnValue(hoisted.gateway);
    hoisted.createStore.mockReturnValue(hoisted.store);
    hoisted.complete.mockResolvedValue({
      connectionId: "97000000-0000-4000-8000-000000000101",
      siteCount: 1,
      nextStep: "select_project",
    });
  });

  it("consumes state and sends a single-site authorization to project selection", async () => {
    const response = await GET(new Request(callbackUrl()));

    expect(hoisted.consumeState).toHaveBeenCalledWith(expect.objectContaining({
      database: hoisted.service,
      provider: "jira",
      purpose: "jira_oauth",
      state: "a".repeat(43),
    }));
    expect(hoisted.complete).toHaveBeenCalledWith({
      gateway: hoisted.gateway,
      store: hoisted.store,
      organisationId: hoisted.context.organisation.id,
      userId: hoisted.context.user.id,
      code: "one-time-code",
    });
    expect(response.headers.get("location")).toBe(
      "https://compliance.example/app/integrations?jira=select-project&connection=97000000-0000-4000-8000-000000000101",
    );
  });

  it("sends a multi-site authorization to site selection with only an opaque setup ID", async () => {
    hoisted.complete.mockResolvedValue({
      setupId: "97000000-0000-4000-8000-000000000102",
      siteCount: 2,
      nextStep: "select_site",
    });
    const response = await GET(new Request(callbackUrl()));
    const location = response.headers.get("location") ?? "";

    expect(location).toBe(
      "https://compliance.example/app/integrations?jira=select-site&setup=97000000-0000-4000-8000-000000000102",
    );
    expect(location).not.toMatch(/token|credential|code=/i);
  });

  it.each([
    ["state", ""],
    ["state", "short"],
    ["code", ""],
    ["code", "line\nbreak"],
  ])("rejects invalid %s before consuming state", async (key, value) => {
    const params = new URLSearchParams({ state: "a".repeat(43), code: "one-time-code" });
    params.set(key, value);
    const response = await GET(new Request(callbackUrl(params)));

    expect(hoisted.consumeState).not.toHaveBeenCalled();
    expect(hoisted.complete).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://compliance.example/app/integrations?jira=connection-failed",
    );
  });

  it("fails closed for replayed, expired, mismatched, or wrong-user state", async () => {
    hoisted.consumeState.mockRejectedValue(new Error("raw state detail"));
    const response = await GET(new Request(callbackUrl()));

    expect(hoisted.complete).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://compliance.example/app/integrations?jira=connection-failed",
    );
  });
});
