import { afterEach, describe, expect, it, vi } from "vitest";
import { jiraProvider } from "./jira";
import type { TicketConnection } from "@/features/integrations/domain/provider";

const oauthConnection: TicketConnection = {
  id: "connection-row-1",
  provider: "jira",
  config: { baseUrl: "https://acme.atlassian.net", projectKey: "SEC" },
  accessToken: "",
  connectionMode: "oauth",
  brokerConnectionId: "nango-connection-1",
  brokerProviderConfigKey: "jira-prod",
};

describe("Jira ticket adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes OAuth-mode ticket reads through the server-side Nango proxy", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "server-secret");
    vi.stubEnv("NANGO_JIRA_INTEGRATION_ID", "jira-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      fields: { status: { name: "In Progress" }, assignee: { displayName: "Taylor" } },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(jiraProvider.fetchTicket(oauthConnection, "SEC-42")).resolves.toEqual({
      status: "In Progress", assignee: "Taylor", url: "https://acme.atlassian.net/browse/SEC-42",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.nango.dev/proxy/rest/api/3/issue/SEC-42?fields=status,assignee",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer server-secret",
          "Connection-Id": "nango-connection-1",
          "Provider-Config-Key": "jira-prod",
          "base-url-override": "https://acme.atlassian.net",
        }),
      }),
    );
  });

  it("keeps local sandbox/manual connections on the direct provider path", async () => {
    const sandboxCredential = crypto.randomUUID();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "10042", key: "SEC-42",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchImpl);

    await jiraProvider.createTicket({
      ...oauthConnection,
      connectionMode: "sandbox",
      accessToken: sandboxCredential,
      brokerConnectionId: null,
      brokerProviderConfigKey: null,
    }, { title: "Fix drift", body: "Enable protection" });

    expect(fetchImpl).toHaveBeenCalledWith("https://acme.atlassian.net/rest/api/3/issue", expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Bearer ${sandboxCredential}` }),
    }));
  });
});
