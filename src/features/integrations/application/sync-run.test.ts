import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ fetchTicket: vi.fn() }));
vi.mock("./registry", () => ({
  resolveTicketProvider: () => ({ fetchTicket: hoisted.fetchTicket }),
}));
vi.mock("@/lib/security/secrets", () => ({ decryptSecret: (value: string | null) => value }));

import { syncTickets } from "./sync-run";

describe("syncTickets connection enablement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not sync tickets whose connection is disabled", async () => {
    const ticketRows = [{
      id: "ticket-1", organisation_id: "org-1", task_id: "task-1",
      connection_id: "connection-1", provider: "github", external_id: "GH-1",
      last_synced_at: null,
      integration_connections: {
        config: { owner: "acme", repo: "isms" }, access_token: "token",
        revoked_at: null, enabled: false,
      },
    }];
    const taskTicketQuery = {
      select: vi.fn().mockResolvedValue({ data: ticketRows, error: null }),
    };
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "task_tickets") return taskTicketQuery;
        throw new Error(`Unexpected write to ${table}`);
      }),
    };

    await expect(syncTickets(supabase as never)).resolves.toEqual({ synced: 0, failed: 0, tasksClosed: 0 });
    expect(taskTicketQuery.select).toHaveBeenCalledWith(expect.stringContaining(
      "integration_connections(config,access_token,revoked_at,enabled,connection_mode,broker_connection_id,broker_provider_config_key)",
    ));
    expect(hoisted.fetchTicket).not.toHaveBeenCalled();
  });

  it("passes an enabled OAuth broker reference to the provider during sync", async () => {
    hoisted.fetchTicket.mockResolvedValue({ status: "In Progress", assignee: "Taylor", url: "https://example.test/42" });
    const ticketRows = [{
      id: "ticket-1", organisation_id: "org-1", task_id: "task-1",
      connection_id: "connection-1", provider: "jira", external_id: "SEC-42",
      last_synced_at: null,
      integration_connections: {
        config: { baseUrl: "https://acme.atlassian.net", projectKey: "SEC" }, access_token: null,
        revoked_at: null, enabled: true, connection_mode: "oauth",
        broker_connection_id: "nango-1", broker_provider_config_key: "jira-prod",
      },
    }];
    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn(() => updateChain);
    updateChain.then = (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve);
    const taskTicketsTable = {
      select: vi.fn().mockResolvedValue({ data: ticketRows, error: null }),
      update: vi.fn(() => updateChain),
    };
    const supabase = { from: vi.fn(() => taskTicketsTable) };

    await expect(syncTickets(supabase as never)).resolves.toEqual({ synced: 1, failed: 0, tasksClosed: 0 });
    expect(hoisted.fetchTicket).toHaveBeenCalledWith(expect.objectContaining({
      connectionMode: "oauth",
      brokerConnectionId: "nango-1",
      brokerProviderConfigKey: "jira-prod",
      accessToken: "",
    }), "SEC-42");
  });
});
