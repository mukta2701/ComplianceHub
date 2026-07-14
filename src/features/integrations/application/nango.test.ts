import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNangoConnectSession,
  deleteNangoConnection,
  nangoProxyFetch,
  nangoProviderConfig,
  resolveJiraOAuthTarget,
  verifyGitHubOAuthTarget,
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
      data: {
        token: connectSessionToken,
        connect_link: "https://api.nango.dev/connect/session-fixture",
        expires_at: "2026-07-14T12:00:00Z",
      },
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
        tags: {
          end_user_id: "user-1",
          end_user_email: "owner@example.test",
          organization_id: "org-1",
        },
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

  it("binds a broker reference to the exact active end user and organisation", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      connections: [{
        id: 42,
        connection_id: "connection-1",
        provider_config_key: "github-prod",
        created: "2026-07-14T12:00:00Z",
        metadata: null,
        provider: "github",
        errors: [],
        end_user: { id: "deprecated-display-only" },
        tags: {
          end_user_id: "user-1",
          end_user_email: "owner@example.test",
          organization_id: "org-1",
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(verifyNangoConnection({
      provider: "github",
      connectionId: "connection-1",
      providerConfigKey: "github-prod",
      endUserId: "user-1",
      endUserEmail: "owner@example.test",
      organisationId: "org-1",
      fetchImpl,
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.nango.dev/connections?connectionId=connection-1&tags%5Bend_user_id%5D=user-1&tags%5Bend_user_email%5D=owner%40example.test&tags%5Borganization_id%5D=org-1",
      expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer nango-secret-value" },
    }));
  });

  it("rejects a broker reference returned for another active user", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      connections: [{
        id: 42, connection_id: "connection-1", provider_config_key: "github-prod",
        created: "2026-07-14T12:00:00Z", metadata: null, provider: "github", errors: [],
        tags: {
          end_user_id: "other-user",
          end_user_email: "owner@example.test",
          organization_id: "org-1",
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(verifyNangoConnection({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
      endUserId: "user-1", endUserEmail: "owner@example.test", organisationId: "org-1", fetchImpl,
    })).rejects.toThrow("Provider authorization is not bound to the active workspace operator");
  });

  it.each(["%2e%2e", "%2Fadmin", "repos?admin=true", "repos#admin"])(
    "rejects unsafe proxy segment %s before fetch",
    async (unsafeSegment) => {
      vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
      vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
      const fetchImpl = vi.fn();

      await expect(nangoProxyFetch({
        provider: "github",
        connectionId: "connection-1",
        providerConfigKey: "github-prod",
        pathSegments: [unsafeSegment],
        fetchImpl,
      })).rejects.toThrow("Invalid provider proxy path segment");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("encodes safe proxy segments, preserves the proxy root, and strips protected headers", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await nangoProxyFetch({
      provider: "github",
      connectionId: "connection-1",
      providerConfigKey: "github-prod",
      pathSegments: ["repos", "acme", "isms", "issues"],
      query: { state: "open" },
      init: {
        headers: {
          Authorization: "caller-secret",
          "Connection-Id": "wrong-connection",
          "Provider-Config-Key": "wrong-provider",
          "Base-Url-Override": "http://169.254.169.254",
          Accept: "application/json",
        },
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.nango.dev/proxy/repos/acme/isms/issues?state=open",
      expect.objectContaining({
        headers: {
          accept: "application/json",
          Authorization: "Bearer nango-secret-value",
          "Connection-Id": "connection-1",
          "Provider-Config-Key": "github-prod",
        },
      }),
    );
  });

  it("rejects a client-reported provider key outside the configured allowlist", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn();

    await expect(verifyNangoConnection({
      provider: "github", connectionId: "connection-1", providerConfigKey: "jira-prod",
      endUserId: "user-1", endUserEmail: "owner@example.test", organisationId: "org-1", fetchImpl,
    })).rejects.toThrow("Provider authorization does not match this deployment");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses an allowlisted deployment base URL and strict provider metadata", () => {
    vi.stubEnv("NANGO_BASE_URL", "https://nango.example.test/");
    vi.stubEnv("NANGO_JIRA_INTEGRATION_ID", "jira-prod");

    expect(nangoProviderConfig("jira")).toEqual({
      baseUrl: "https://nango.example.test",
      integrationId: "jira-prod",
      secretKey: null,
    });
  });

  it("rejects a Nango base URL with credentials, query, fragment, or path", () => {
    for (const unsafe of [
      "https://user@example.test",
      "https://nango.example.test/evil",
      "https://nango.example.test?target=evil",
      "https://nango.example.test#evil",
    ]) {
      vi.stubEnv("NANGO_BASE_URL", unsafe);
      expect(() => nangoProviderConfig("github")).toThrow("NANGO_BASE_URL must be an origin");
    }
  });

  it("matches a Jira tenant to accessible resources and verifies the selected project", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_JIRA_INTEGRATION_ID", "jira-prod");
    const cloudId = "1324a887-45db-4bf4-8e99-ef0ff456d421";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: cloudId,
        name: "Example Jira",
        url: "https://acme.atlassian.net",
        scopes: ["read:jira-work", "write:jira-work"],
        avatarUrl: "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/jira.png",
      }]), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "10000", key: "SEC", name: "Security" }), {
        status: 200, headers: { "content-type": "application/json" },
      }));

    await expect(resolveJiraOAuthTarget({
      connectionId: "connection-1", providerConfigKey: "jira-prod",
      baseUrl: "https://acme.atlassian.net", projectKey: "SEC", fetchImpl,
    })).resolves.toEqual({ cloudId });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.nango.dev/proxy/oauth/token/accessible-resources");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      `https://api.nango.dev/proxy/ex/jira/${cloudId}/rest/api/3/project/SEC`,
    );
  });

  it("rejects a Jira tenant that is not in the connection's accessible resources", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_JIRA_INTEGRATION_ID", "jira-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      id: "1324a887-45db-4bf4-8e99-ef0ff456d421", name: "Other Jira",
      url: "https://other.atlassian.net", scopes: ["read:jira-work"],
    }]), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(resolveJiraOAuthTarget({
      connectionId: "connection-1", providerConfigKey: "jira-prod",
      baseUrl: "https://acme.atlassian.net", projectKey: "SEC", fetchImpl,
    })).rejects.toThrow("Jira site is not accessible through this authorization");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("requires an exact root Jira tenant URL match, not only the same origin", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_JIRA_INTEGRATION_ID", "jira-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      id: "1324a887-45db-4bf4-8e99-ef0ff456d421", name: "Malformed Jira",
      url: "https://acme.atlassian.net/other", scopes: ["read:jira-work"],
    }]), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(resolveJiraOAuthTarget({
      connectionId: "connection-1", providerConfigKey: "jira-prod",
      baseUrl: "https://acme.atlassian.net", projectKey: "SEC", fetchImpl,
    })).rejects.toThrow("Jira site is not accessible through this authorization");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("verifies a GitHub OAuth repository target through the broker", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(verifyGitHubOAuthTarget({
      connectionId: "connection-1", providerConfigKey: "github-prod", owner: "acme", repo: "isms", fetchImpl,
    })).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.nango.dev/proxy/repos/acme/isms");
  });

  it("deletes a broker connection before local revoke and treats missing as idempotent", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));

    await expect(deleteNangoConnection({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod", fetchImpl,
    })).resolves.toBeUndefined();
    await expect(deleteNangoConnection({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod", fetchImpl,
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenNthCalledWith(1,
      "https://api.nango.dev/connections/connection-1?provider_config_key=github-prod",
      expect.objectContaining({ method: "DELETE", headers: { Authorization: "Bearer nango-secret-value" } }),
    );
  });

  it("fails closed when broker connection deletion fails", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response("provider unavailable", { status: 503 }));

    await expect(deleteNangoConnection({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod", fetchImpl,
    })).rejects.toThrow("Provider connection could not be retired");
  });

  it("fails closed when broker deletion reports an unsuccessful result", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "nango-secret-value");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(deleteNangoConnection({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod", fetchImpl,
    })).rejects.toThrow("Provider connection could not be retired");
  });
});
