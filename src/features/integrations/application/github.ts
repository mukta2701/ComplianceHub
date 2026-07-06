import type { TicketProvider, TicketConnection, CreateTicketInput } from "@/features/integrations/domain/provider";

// Thin GitHub Issues adapter. config = { owner, repo }. Requires a real token in
// connection.accessToken (user go-live step). Not network-tested.
function repoPath(conn: TicketConnection): string {
  const c = conn.config as { owner?: string; repo?: string };
  return `${String(c.owner ?? "")}/${String(c.repo ?? "")}`;
}

export const githubProvider: TicketProvider = {
  async createTicket(conn: TicketConnection, input: CreateTicketInput) {
    const res = await fetch(`https://api.github.com/repos/${repoPath(conn)}/issues`, {
      method: "POST",
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    if (!res.ok) throw new Error(`GitHub createTicket failed: ${res.status}`);
    const data = (await res.json()) as { number: number; html_url: string; state: string };
    return { externalId: String(data.number), url: data.html_url, status: data.state === "open" ? "To Do" : "Done" };
  },
  async fetchTicket(conn: TicketConnection, externalId: string) {
    const res = await fetch(`https://api.github.com/repos/${repoPath(conn)}/issues/${encodeURIComponent(externalId)}`, {
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub fetchTicket failed: ${res.status}`);
    const data = (await res.json()) as { html_url: string; state: string; assignee?: { login?: string } | null };
    return { status: data.state === "open" ? "In Progress" : "Done", assignee: data.assignee?.login ?? null, url: data.html_url };
  },
};
