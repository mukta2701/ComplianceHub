import type { TicketProvider, TicketConnection, CreateTicketInput } from "@/features/integrations/domain/provider";
import { nangoProxyFetch } from "./nango";

// Thin Jira Cloud adapter. config = { baseUrl, projectKey }. Requires a real
// OAuth access token in connection.accessToken (user go-live step). Not network-
// tested — the fake provider proves the in-app flow.
function baseUrl(conn: TicketConnection): string {
  return String((conn.config as { baseUrl?: string }).baseUrl ?? "").replace(/\/+$/, "");
}

function jiraFetch(conn: TicketConnection, path: string, init: RequestInit = {}) {
  if (conn.connectionMode === "oauth") {
    const headers = new Headers(init.headers);
    headers.set("Base-Url-Override", baseUrl(conn));
    return nangoProxyFetch({
      provider: "jira",
      connectionId: conn.brokerConnectionId,
      providerConfigKey: conn.brokerProviderConfigKey,
      path,
      init: { ...init, headers },
    });
  }
  return fetch(`${baseUrl(conn)}/${path}`, init);
}

export const jiraProvider: TicketProvider = {
  async createTicket(conn: TicketConnection, input: CreateTicketInput) {
    const projectKey = String((conn.config as { projectKey?: string }).projectKey ?? "");
    const res = await jiraFetch(conn, "rest/api/3/issue", {
      method: "POST",
      headers: { authorization: `Bearer ${conn.accessToken}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey }, summary: input.title, issuetype: { name: "Task" },
          description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: input.body }] }] },
        },
      }),
    });
    if (!res.ok) throw new Error(`Jira createTicket failed: ${res.status}`);
    const data = (await res.json()) as { id: string; key: string };
    return { externalId: data.key, url: `${baseUrl(conn)}/browse/${data.key}`, status: "To Do" };
  },
  async fetchTicket(conn: TicketConnection, externalId: string) {
    const res = await jiraFetch(conn, `rest/api/3/issue/${encodeURIComponent(externalId)}?fields=status,assignee`, {
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Jira fetchTicket failed: ${res.status}`);
    const data = (await res.json()) as { fields: { status?: { name?: string }; assignee?: { displayName?: string } | null } };
    return {
      status: data.fields.status?.name ?? "Unknown",
      assignee: data.fields.assignee?.displayName ?? null,
      url: `${baseUrl(conn)}/browse/${externalId}`,
    };
  },
};
