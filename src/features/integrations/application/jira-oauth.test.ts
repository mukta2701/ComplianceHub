import { describe, expect, it, vi } from "vitest";
import {
  JIRA_WEBHOOK_EVENTS,
  JIRA_OAUTH_SCOPE,
  buildJiraAuthorizationUrl,
  completeJiraAuthorization,
  createJiraOAuthGateway,
  JiraProviderError,
  type JiraAccessibleResource,
  type JiraConnectionStore,
  type JiraOAuthGateway,
} from "./jira-oauth";

const organisationId = "94000000-0000-4000-8000-000000000001";
const userId = "94000000-0000-4000-8000-000000000002";
const cloudIdA = "94000000-0000-4000-8000-000000000101";
const cloudIdB = "8594f221-9797-5f78-1fa4-485e198d7cd0";
const callbackUrl = "https://compliance.example/api/integrations/jira/callback";
const accessCredential = ["jira", "access", "credential"].join("-");
const refreshCredential = ["jira", "refresh", "credential"].join("-");
const clientFixture = ["synthetic", "client", "fixture"].join("-");
const webhookCallbackToken = "W".repeat(43);
const webhookCallbackUrl = `https://compliance.example/api/webhooks/jira/${webhookCallbackToken}`;
const siteAName = "Sample Jira A";
const siteBName = "Sample Jira B";
const siteAUrl = ["https://", "sample-a", ".atlassian.net"].join("");
const siteBUrl = ["https://", "sample-b", ".atlassian.net"].join("");

function siteFixture(cloudId: string, name: string, url: string): JiraAccessibleResource {
  const site = Object.create(null) as JiraAccessibleResource;
  site.cloudId = cloudId;
  site.name = name;
  site.url = url;
  site.scopes = ["read:jira-work", "manage:jira-webhook"];
  return site;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function gateway(overrides: Partial<JiraOAuthGateway> = {}): JiraOAuthGateway {
  return {
    exchangeAuthorizationCode: vi.fn(async () => ({
      accessToken: accessCredential,
      refreshToken: refreshCredential,
      expiresAt: "2026-07-14T14:00:00.000Z",
      scope: JIRA_OAUTH_SCOPE,
    })),
    refreshAuthorization: vi.fn(),
    listAccessibleResources: vi.fn(async () => [{
      cloudId: cloudIdA,
      name: siteAName,
      url: siteAUrl,
      scopes: ["read:jira-work", "manage:jira-webhook"],
    }]),
    listProjects: vi.fn(),
    listDynamicWebhooks: vi.fn(),
    registerDynamicWebhook: vi.fn(),
    refreshDynamicWebhook: vi.fn(),
    deleteDynamicWebhook: vi.fn(),
    ...overrides,
  };
}

function store(overrides: Partial<JiraConnectionStore> = {}): JiraConnectionStore {
  return {
    saveAuthorization: vi.fn(async () => "94000000-0000-4000-8000-000000000201"),
    savePendingAuthorization: vi.fn(async () => "94000000-0000-4000-8000-000000000202"),
    finalizePendingAuthorization: vi.fn(async () => "94000000-0000-4000-8000-000000000201"),
    readAccessCredential: vi.fn(),
    claimRefreshLease: vi.fn(),
    completeRefreshLease: vi.fn(),
    releaseRefreshLease: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  };
}

describe("native Jira OAuth gateway", () => {
  it("builds the exact least-privilege Atlassian authorization request", () => {
    const url = new URL(buildJiraAuthorizationUrl({
      clientId: "jira-client-id",
      clientSecret: clientFixture,
      callbackUrl,
    }, "a".repeat(43)));

    expect(url.origin + url.pathname).toBe("https://auth.atlassian.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      audience: "api.atlassian.com",
      client_id: "jira-client-id",
      scope: "read:jira-work manage:jira-webhook offline_access",
      redirect_uri: callbackUrl,
      state: "a".repeat(43),
      response_type: "code",
      prompt: "consent",
    });
    expect(url.search).not.toContain("write%3Ajira-work");
  });

  it.each([
    "ftp://localhost/api/integrations/jira/callback",
    "https://user:pass@compliance.example/api/integrations/jira/callback",
    "https://compliance.example:8443/api/integrations/jira/callback",
    "https://compliance.example/wrong/callback",
    "https://compliance.example/api/integrations/jira/callback?next=bad",
    "https://compliance.example/api/integrations/jira/callback#bad",
  ])("rejects an unsafe or non-canonical OAuth callback: %s", (unsafeCallback) => {
    expect(() => buildJiraAuthorizationUrl({
      clientId: "jira-client-id", clientSecret: clientFixture, callbackUrl: unsafeCallback,
    }, "a".repeat(43))).toThrow("Jira connection is unavailable");
  });

  it("lists, registers, refreshes, and deletes one bounded combined dynamic webhook", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        startAt: 0,
        maxResults: 50,
        total: 1,
        isLast: true,
        values: [{
          id: 71001,
          jqlFilter: 'project IN ("ENG","SEC")',
          events: [...JIRA_WEBHOOK_EVENTS],
          expirationDate: "2026-07-14T00:00:00.000+0000",
          url: webhookCallbackUrl,
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        webhookRegistrationResult: [{ createdWebhookId: 71002 }],
      }))
      .mockResolvedValueOnce(jsonResponse({ expirationDate: "2026-08-12T00:00:00.000+0000" }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id", clientSecret: clientFixture, callbackUrl,
    }, fetchImpl);

    await expect(provider.listDynamicWebhooks({ accessToken: accessCredential, cloudId: cloudIdA }))
      .resolves.toEqual([{
        id: "71001",
        jqlFilter: 'project IN ("ENG","SEC")',
        events: [...JIRA_WEBHOOK_EVENTS],
        expiresAt: "2026-07-14T00:00:00.000Z",
        url: webhookCallbackUrl,
      }]);
    expect(fetchImpl).toHaveBeenNthCalledWith(1,
      `https://api.atlassian.com/ex/jira/${cloudIdA}/rest/api/3/webhook?startAt=0&maxResults=100`,
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
    await expect(provider.registerDynamicWebhook({
      accessToken: accessCredential,
      cloudId: cloudIdA,
      callbackUrl: webhookCallbackUrl,
      projectKeys: ["SEC", "ENG"],
    })).resolves.toEqual({ id: "71002" });
    await expect(provider.refreshDynamicWebhook({
      accessToken: accessCredential, cloudId: cloudIdA, webhookId: "71002",
    })).resolves.toEqual({ expiresAt: "2026-08-12T00:00:00.000Z" });
    await expect(provider.deleteDynamicWebhook({
      accessToken: accessCredential, cloudId: cloudIdA, webhookId: "71001",
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      `https://api.atlassian.com/ex/jira/${cloudIdA}/rest/api/3/webhook`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: webhookCallbackUrl,
          webhooks: [{
            jqlFilter: 'project IN ("ENG","SEC")',
            events: [...JIRA_WEBHOOK_EVENTS],
          }],
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(3,
      `https://api.atlassian.com/ex/jira/${cloudIdA}/rest/api/3/webhook/refresh`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ webhookIds: [71002] }) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(4,
      `https://api.atlassian.com/ex/jira/${cloudIdA}/rest/api/3/webhook`,
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ webhookIds: [71001] }) }),
    );
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    }
  });

  it("rejects malformed webhook responses without reflecting access credentials", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      webhookRegistrationResult: [{ createdWebhookId: -1, leaked: accessCredential }],
    }));
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id", clientSecret: clientFixture, callbackUrl,
    }, fetchImpl);
    await expect(provider.registerDynamicWebhook({
      accessToken: accessCredential,
      cloudId: cloudIdA,
      callbackUrl: webhookCallbackUrl,
      projectKeys: ["SEC"],
    })).rejects.toThrow("Jira returned invalid webhook metadata");
  });

  it("rejects a partial dynamic-webhook page instead of replacing an unseen current webhook", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      startAt: 0,
      maxResults: 100,
      total: 101,
      isLast: false,
      values: [],
    }));
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id", clientSecret: clientFixture, callbackUrl,
    }, fetchImpl);
    await expect(provider.listDynamicWebhooks({ accessToken: accessCredential, cloudId: cloudIdA }))
      .rejects.toThrow("Jira returned invalid webhook metadata");
  });

  it("exchanges a code through the documented token endpoint and validates the bounded response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      access_token: accessCredential,
      refresh_token: refreshCredential,
      expires_in: 3600,
      scope: JIRA_OAUTH_SCOPE,
      token_type: "Bearer",
    }));
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id",
      clientSecret: clientFixture,
      callbackUrl,
    }, fetchImpl, () => new Date("2026-07-14T13:00:00.000Z"));

    await expect(provider.exchangeAuthorizationCode("one-time-code")).resolves.toEqual({
      accessToken: accessCredential,
      refreshToken: refreshCredential,
      expiresAt: "2026-07-14T14:00:00.000Z",
      scope: JIRA_OAUTH_SCOPE,
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: "jira-client-id",
        client_secret: clientFixture,
        code: "one-time-code",
        redirect_uri: callbackUrl,
      }),
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects malformed or over-broad token responses without reflecting credentials", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      access_token: accessCredential,
      refresh_token: refreshCredential,
      expires_in: 3600,
      scope: `${JIRA_OAUTH_SCOPE} write:jira-work`,
      unexpected: "field",
    }));
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id",
      clientSecret: clientFixture,
      callbackUrl,
    }, fetchImpl);

    try {
      await provider.exchangeAuthorizationCode("one-time-code");
      throw new Error("expected failure");
    } catch (error) {
      expect(String(error)).toContain("invalid authorization response");
      expect(String(error)).not.toContain(accessCredential);
      expect(String(error)).not.toContain(refreshCredential);
      expect(String(error)).not.toContain("write:jira-work");
    }
  });

  it("cancels a provider body that exceeds the hard response limit", async () => {
    const fetchImpl = vi.fn(async () => new Response(`{\"padding\":\"${"x".repeat(2 * 1024 * 1024)}\"}`, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id",
      clientSecret: clientFixture,
      callbackUrl,
    }, fetchImpl);

    await expect(provider.exchangeAuthorizationCode("one-time-code"))
      .rejects.toThrow("Jira returned an invalid authorization response");
  });

  it("validates and sorts all accessible Jira sites", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([
      {
        id: cloudIdB,
        name: siteBName,
        url: siteBUrl,
        scopes: ["read:jira-work", "manage:jira-webhook"],
        avatarUrl: "https://site-admin-avatar-cdn.prod.public.atl-paas.net/avatars/240/flag.png",
      },
      {
        id: cloudIdA,
        name: siteAName,
        url: siteAUrl,
        scopes: ["manage:jira-webhook", "read:jira-work"],
      },
    ]));
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id", clientSecret: clientFixture, callbackUrl,
    }, fetchImpl);

    await expect(provider.listAccessibleResources(accessCredential)).resolves.toEqual([
      {
        cloudId: cloudIdA,
        name: siteAName,
        url: siteAUrl,
        scopes: ["manage:jira-webhook", "read:jira-work"],
      },
      {
        cloudId: cloudIdB,
        name: siteBName,
        url: siteBUrl,
        scopes: ["read:jira-work", "manage:jira-webhook"],
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.atlassian.com/oauth/token/accessible-resources",
      expect.objectContaining({ headers: { authorization: `Bearer ${accessCredential}`, accept: "application/json" } }),
    );
  });

  it("rejects a resource outside an exact atlassian.net HTTPS host", async () => {
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id", clientSecret: clientFixture, callbackUrl,
    }, vi.fn(async () => jsonResponse([{
      id: cloudIdA,
      name: "Spoofed Jira",
      url: `${siteAUrl}.attacker.example`,
      scopes: ["read:jira-work", "manage:jira-webhook"],
    }])));

    await expect(provider.listAccessibleResources(accessCredential))
      .rejects.toThrow("Jira returned invalid site metadata");
  });

  it("paginates the documented project search endpoint with a hard result bound", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        maxResults: 2, startAt: 0, total: 3, isLast: false,
        values: [
          {
            id: "10001",
            key: "SEC",
            name: "Security",
            archived: false,
            lead: { accountId: "atlassian-user-1", displayName: "Security owner" },
            insight: { lastIssueUpdateTime: "2026-07-14T12:00:00.000+0000", totalIssueCount: 12 },
            projectCategory: {
              id: "10010",
              name: "Security programmes",
              description: "Security and compliance work",
              self: "https://api.atlassian.com/ex/jira/site/rest/api/3/projectCategory/10010",
            },
          },
          { id: "10002", key: "GRC", name: "Governance" },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        maxResults: 2, startAt: 2, total: 3, isLast: true,
        values: [{ id: "10003", key: "RISK", name: "Risk" }],
      }));
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id", clientSecret: clientFixture, callbackUrl,
    }, fetchImpl);

    await expect(provider.listProjects({ accessToken: accessCredential, cloudId: cloudIdA }))
      .resolves.toEqual([
        { id: "10002", key: "GRC", name: "Governance" },
        { id: "10003", key: "RISK", name: "Risk" },
        { id: "10001", key: "SEC", name: "Security" },
      ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `https://api.atlassian.com/ex/jira/${cloudIdA}/rest/api/3/project/search?startAt=0&maxResults=50`,
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `https://api.atlassian.com/ex/jira/${cloudIdA}/rest/api/3/project/search?startAt=2&maxResults=50`,
      expect.any(Object),
    );
  });

  it("maps Atlassian invalid_grant to a fixed authorization-expired failure", async () => {
    const provider = createJiraOAuthGateway({
      clientId: "jira-client-id", clientSecret: clientFixture, callbackUrl,
    }, vi.fn(async () => jsonResponse({ error: "invalid_grant", error_description: refreshCredential }, 403)));

    await expect(provider.refreshAuthorization(refreshCredential)).rejects.toMatchObject({
      name: "JiraProviderError",
      code: "authorization_expired",
      message: "Jira access needs to be reconnected.",
    } satisfies Partial<JiraProviderError>);
  });
});

describe("completeJiraAuthorization", () => {
  it("stores a multi-site authorization server-side until the operator selects a site", async () => {
    const persistence = store();
    const provider = gateway({
      listAccessibleResources: vi.fn(async () => [
        siteFixture(cloudIdB, siteBName, siteBUrl),
        siteFixture(cloudIdA, siteAName, siteAUrl),
      ]),
    });

    await expect(completeJiraAuthorization({
      gateway: provider,
      store: persistence,
      organisationId,
      userId,
      code: "one-time-code",
    })).resolves.toEqual({
      setupId: "94000000-0000-4000-8000-000000000202",
      siteCount: 2,
      nextStep: "select_site",
    });
    expect(persistence.savePendingAuthorization).toHaveBeenCalledWith({
      organisationId,
      userId,
      sites: [
        siteFixture(cloudIdA, siteAName, siteAUrl),
        siteFixture(cloudIdB, siteBName, siteBUrl),
      ],
      tokens: {
        accessToken: accessCredential,
        refreshToken: refreshCredential,
        expiresAt: "2026-07-14T14:00:00.000Z",
        scope: JIRA_OAUTH_SCOPE,
      },
    });
    expect(persistence.saveAuthorization).not.toHaveBeenCalled();
  });

  it("creates a disabled connection immediately when authorization contains one site", async () => {
    const persistence = store();

    await expect(completeJiraAuthorization({
      gateway: gateway(),
      store: persistence,
      organisationId,
      userId,
      code: "one-time-code",
    })).resolves.toEqual({
      connectionId: "94000000-0000-4000-8000-000000000201",
      siteCount: 1,
      nextStep: "select_project",
    });
    expect(persistence.saveAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      site: expect.objectContaining({ cloudId: cloudIdA }),
    }));
    expect(persistence.savePendingAuthorization).not.toHaveBeenCalled();
  });

  it("requires at least one site with the requested Jira permissions", async () => {
    const persistence = store();
    await expect(completeJiraAuthorization({
      gateway: gateway({ listAccessibleResources: vi.fn(async () => []) }),
      store: persistence,
      organisationId,
      userId,
      code: "one-time-code",
    })).rejects.toThrow("No accessible Jira site was found");
    expect(persistence.saveAuthorization).not.toHaveBeenCalled();
    expect(persistence.savePendingAuthorization).not.toHaveBeenCalled();
  });
});
