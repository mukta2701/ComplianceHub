import type { TicketProvider, TicketConnection, CreateTicketInput } from "@/features/integrations/domain/provider";
import { nangoProxyFetch } from "./nango";
import { githubConnectionTargetSchema } from "./connection";

// Thin GitHub Issues adapter. config = { owner, repo }. Requires a real token in
// connection.accessToken (user go-live step). Not network-tested.
function repository(conn: TicketConnection): { owner: string; repo: string } {
  const c = conn.config as { owner?: string; repo?: string };
  const parsed = githubConnectionTargetSchema.parse({ provider: "github", owner: c.owner, repo: c.repo });
  return { owner: parsed.owner, repo: parsed.repo };
}

function githubFetch(conn: TicketConnection, pathSegments: string[], init: RequestInit = {}) {
  if (conn.connectionMode === "oauth") {
    return nangoProxyFetch({
      provider: "github",
      connectionId: conn.brokerConnectionId,
      providerConfigKey: conn.brokerProviderConfigKey,
      pathSegments,
      init,
    });
  }
  return fetch(`https://api.github.com/${pathSegments.map((segment) => encodeURIComponent(segment)).join("/")}`, init);
}

export const githubProvider: TicketProvider = {
  async createTicket(conn: TicketConnection, input: CreateTicketInput) {
    const { owner, repo } = repository(conn);
    const res = await githubFetch(conn, ["repos", owner, repo, "issues"], {
      method: "POST",
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    if (!res.ok) throw new Error(`GitHub createTicket failed: ${res.status}`);
    const data = (await res.json()) as { number: number; html_url: string; state: string };
    return { externalId: String(data.number), url: data.html_url, status: data.state === "open" ? "To Do" : "Done" };
  },
  async fetchTicket(conn: TicketConnection, externalId: string) {
    const { owner, repo } = repository(conn);
    const res = await githubFetch(conn, ["repos", owner, repo, "issues", externalId], {
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub fetchTicket failed: ${res.status}`);
    const data = (await res.json()) as { html_url: string; state: string; assignee?: { login?: string } | null };
    return { status: data.state === "open" ? "In Progress" : "Done", assignee: data.assignee?.login ?? null, url: data.html_url };
  },
};
