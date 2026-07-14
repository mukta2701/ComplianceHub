import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  selectCalls: [] as Array<{ table: string; columns: string }>,
  filterCalls: [] as Array<{ table: string; column: string; value: string }>,
  errors: {} as Record<string, { message: string } | undefined>,
  rows: {
    integration_connections: [{
      id: "connection-1", provider: "github", label: "GitHub", config: { owner: "acme", repo: "isms" },
      connection_mode: "oauth", enabled: true, created_at: "2026-07-14T00:00:00Z", revoked_at: null,
    }, {
      id: "revoked-connection", provider: "jira", label: "Old Jira", config: { projectKey: "OLD" },
      connection_mode: "sandbox", enabled: false, created_at: "2026-07-13T00:00:00Z", revoked_at: "2026-07-14T00:00:00Z",
    }],
    alert_channels: [{
      id: "channel-1", type: "slack", label: "#compliance-alerts", min_severity: "high",
      enabled: true, created_at: "2026-07-14T00:00:00Z", revoked_at: null,
    }, {
      id: "revoked-channel", type: "slack", label: "#old-alerts", min_severity: "high",
      enabled: false, created_at: "2026-07-13T00:00:00Z", revoked_at: "2026-07-14T00:00:00Z",
    }],
  } as Record<string, unknown[]>,
}));

function query(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((columns: string) => {
    hoisted.selectCalls.push({ table, columns });
    return chain;
  });
  chain.eq = vi.fn((column: string, value: string) => {
    hoisted.filterCalls.push({ table, column, value });
    return chain;
  });
  for (const method of ["is", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown) =>
    Promise.resolve({ data: hoisted.rows[table] ?? [], error: hoisted.errors[table] ?? null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: (table: string) => query(table) },
    organisation: { id: "org-1", name: "Example Ltd" },
    membership: { role: "admin" },
    user: { id: "user-1", email: "admin@example.test" },
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/integrations", useRouter: () => ({ refresh: vi.fn() }) }));

import IntegrationsPage from "./page";

describe("Settings Connections page", () => {
  beforeEach(() => {
    hoisted.selectCalls = [];
    hoisted.filterCalls = [];
    hoisted.errors = {};
  });

  it("renders the focused provider catalogue without the removed production sections", async () => {
    render(await IntegrationsPage());

    expect(screen.getByRole("heading", { name: "Connections" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveTextContent("Connected");
    expect(screen.getByRole("article", { name: "Jira connection" })).toHaveTextContent("Not connected");
    expect(screen.getByRole("article", { name: "Slack connection" })).toHaveTextContent("Connected");
    expect(screen.queryByRole("heading", { name: "Monitoring sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evidence sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alert channels" })).not.toBeInTheDocument();
    expect(screen.queryByText("Local preview tools")).not.toBeInTheDocument();
    expect(screen.queryByText(/OAuth|SSO|Nango/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByText("Old Jira")).not.toBeInTheDocument();
    expect(screen.queryByText("#old-alerts")).not.toBeInTheDocument();

    const expectedColumns: Record<string, string> = {
      integration_connections: "id,provider,label,config,connection_mode,enabled,created_at,revoked_at",
      alert_channels: "id,type,label,min_severity,enabled,created_at,revoked_at",
    };
    expect(hoisted.selectCalls).toHaveLength(2);
    for (const call of hoisted.selectCalls) {
      expect(call.columns).toBe(expectedColumns[call.table]);
    }
  });

  it("scopes every connection dataset to the active workspace", async () => {
    await IntegrationsPage();

    expect(hoisted.filterCalls).toEqual([
      { table: "integration_connections", column: "organisation_id", value: "org-1" },
      { table: "alert_channels", column: "organisation_id", value: "org-1" },
    ]);
  });

  it.each(["integration_connections", "alert_channels"])("fails closed when %s cannot load", async (table) => {
    hoisted.errors[table] = { message: "query unavailable" };

    await expect(IntegrationsPage()).rejects.toThrow("Could not load connection settings");
  });
});
