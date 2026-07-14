export type IntegrationProvider = "jira" | "github";

export type TicketConnection = {
  id: string;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  accessToken: string;
  connectionMode?: "sandbox" | "oauth";
  brokerConnectionId?: string | null;
  brokerProviderConfigKey?: string | null;
};
export type CreateTicketInput = { title: string; body: string };
export type CreatedTicket = { externalId: string; url: string; status: string };
export type FetchedTicket = { status: string; assignee: string | null; url: string };

export interface TicketProvider {
  createTicket(connection: TicketConnection, input: CreateTicketInput): Promise<CreatedTicket>;
  fetchTicket(connection: TicketConnection, externalId: string): Promise<FetchedTicket>;
}

// Deterministic in-memory-free fake: createTicket always yields "To Do", fetch
// always yields "In Progress", so a push then a poll (separate requests, no
// shared state) produce an observable status transition in tests and e2e.
function stableId(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return `FAKE-${hash.toString(36).toUpperCase()}`;
}

export const fakeTicketProvider: TicketProvider = {
  async createTicket(connection, input) {
    const externalId = stableId(input.title);
    return { externalId, url: `https://tracker.local/${connection.provider}/${externalId}`, status: "To Do" };
  },
  async fetchTicket(connection, externalId) {
    return { status: "In Progress", assignee: "auto-bot", url: `https://tracker.local/${connection.provider}/${externalId}` };
  },
};
