import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNangoConnectSession,
  nangoProviderConfig,
  verifyNangoConnection,
} from "./nango";

describe("Nango OAuth brokerage boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports an explicit unconfigured state without making a request", async () => {
    const fetchImpl = vi.fn();

    await expect(createNangoConnectSession({
      provider: "github",
      endUser: { id: "user-1", email: "owner@example.test", displayName: "Owner" },
      organisation: { id: "org-1", displayName: "Example Ltd" },
      fetchImpl,
    })).resolves.toEqual({ configured: false });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a provider-restricted session and returns no server secret", async () => {
    const connectSessionToken = crypto.randomUUID();
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { token: connectSessionToken, expires_at: "2026-07-14T12:00:00Z" },
    }), { status: 201, headers: { "content-type": "application/json" } }));

    const result = await createNangoConnectSession({
      provider: "github",
      endUser: { id: "user-1", email: "owner@example.test", displayName: "Owner" },
      organisation: { id: "org-1", displayName: "Example Ltd" },
      fetchImpl,
    });

    expect(result).toEqual({
      configured: true,
      token: connectSessionToken,
      expiresAt: "2026-07-14T12:00:00Z",
      apiBaseUrl: "https://api.nango.dev",
    });
    expect(JSON.stringify(result)).not.toContain("nango-secret-value");
    expect(fetchImpl).toHaveBeenCalledWith("https://api.nango.dev/connect/sessions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer nango-secret-value" }),
      body: JSON.stringify({
        end_user: { id: "user-1", email: "owner@example.test", display_name: "Owner" },
        organization: { id: "org-1", display_name: "Example Ltd" },
        allowed_integrations: ["github-prod"],
      }),
    }));
  });

  it("fails closed when Nango rejects session creation", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_JIRA_INTEGRATION_ID", "jira-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response("credential detail", { status: 401 }));

    await expect(createNangoConnectSession({
      provider: "jira",
      endUser: { id: "user-1", email: "owner@example.test", displayName: "Owner" },
      organisation: { id: "org-1", displayName: "Example Ltd" },
      fetchImpl,
    })).rejects.toThrow("Could not start provider authorization");
  });

  it("verifies the broker reference with a safe provider identity request", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(verifyNangoConnection({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod", fetchImpl,
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith("https://api.nango.dev/proxy/user", expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({
        Authorization: "Bearer nango-secret-value",
        "Connection-Id": "connection-1",
        "Provider-Config-Key": "github-prod",
      }),
    }));
  });

  it("rejects a client-reported provider key outside the configured allowlist", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn();

    await expect(verifyNangoConnection({
      provider: "github", connectionId: "connection-1", providerConfigKey: "jira-prod", fetchImpl,
    })).rejects.toThrow("Provider authorization does not match this deployment");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses an allowlisted deployment base URL and strict provider metadata", () => {
    vi.stubEnv("NANGO_BASE_URL", "https://nango.example.test/");
    vi.stubEnv("NANGO_JIRA_INTEGRATION_ID", "jira-prod");

    expect(nangoProviderConfig("jira")).toEqual({
      baseUrl: "https://nango.example.test",
      integrationId: "jira-prod",
      verificationPath: "rest/api/3/myself",
      secretKey: null,
    });
  });
});
