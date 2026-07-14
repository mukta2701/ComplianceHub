import { afterEach, describe, expect, it, vi } from "vitest";
import { githubProvider } from "./github";
import type { TicketConnection } from "@/features/integrations/domain/provider";

const oauthConnection: TicketConnection = {
  id: "connection-row-1",
  provider: "github",
  config: { owner: "acme", repo: "isms" },
  accessToken: "",
  connectionMode: "oauth",
  brokerConnectionId: "nango-connection-1",
  brokerProviderConfigKey: "github-prod",
};

describe("GitHub ticket adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes OAuth-mode issue creation through the server-side Nango proxy", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "server-secret");
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      number: 42, html_url: "https://github.com/acme/isms/issues/42", state: "open",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(githubProvider.createTicket(oauthConnection, { title: "Fix drift", body: "Enable protection" })).resolves.toEqual({
      externalId: "42", url: "https://github.com/acme/isms/issues/42", status: "To Do",
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://api.nango.dev/proxy/repos/acme/isms/issues", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer server-secret",
        "Connection-Id": "nango-connection-1",
        "Provider-Config-Key": "github-prod",
      }),
    }));
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty("authorization");
    expect(JSON.stringify(fetchImpl.mock.calls[0])).not.toContain('"accessToken"');
  });

  it("fails closed before a network call when the broker secret is unavailable", async () => {
    vi.stubEnv("NANGO_GITHUB_INTEGRATION_ID", "github-prod");
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(githubProvider.fetchTicket(oauthConnection, "42")).rejects.toThrow("Provider setup is required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
