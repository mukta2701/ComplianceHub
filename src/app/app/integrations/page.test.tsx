import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  selectCalls: [] as Array<{ table: string; columns: string }>,
  filterCalls: [] as Array<{ table: string; column: string; value: string }>,
  errors: {} as Record<string, { message: string } | undefined>,
  role: "admin" as "owner" | "admin" | "member",
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
      enabled: true, daily_digest_enabled: false, created_at: "2026-07-14T00:00:00Z", revoked_at: null,
    }, {
      id: "revoked-channel", type: "slack", label: "#old-alerts", min_severity: "high",
      enabled: false, daily_digest_enabled: false, created_at: "2026-07-13T00:00:00Z", revoked_at: "2026-07-14T00:00:00Z",
    }],
    daily_digest_deliveries: [{
      id: "delivery-1", digest_on: "2026-08-07", channel_id: "channel-1", status: "delivered",
      attempt_count: 1, error_code: null, last_attempted_at: "2026-08-07T08:00:00Z", delivered_at: "2026-08-07T08:00:01Z",
      message: { text: "must never be selected" },
    }],
    github_installations: [{
      id: "10000000-0000-4000-8000-000000000010", account_login: "Adtecher", status: "active",
      repository_selection: "selected", permissions_ok: true, updated_at: "2026-08-17T18:00:00Z", revoked_at: null,
    }],
    github_repository_shadow_summaries: [{
      repository_id: "10000000-0000-4000-8000-000000000011",
      installation_id: "10000000-0000-4000-8000-000000000010",
      full_name: "Adtecher/compliancehub", html_url: "https://github.com/Adtecher/compliancehub",
      visibility: "private", default_branch: "main", archived: false, selected: true, available: true,
      last_seen_at: "2026-08-17T18:00:00Z", latest_run_id: null, latest_trigger_type: null,
      latest_status: null, latest_diagnostic_code: null, latest_started_at: null, latest_completed_at: null,
      latest_observation_count: null, latest_passed_count: null, latest_failed_count: null,
      latest_unknown_count: null, latest_not_applicable_count: null, last_completed_collection_at: null,
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
    membership: { role: hoisted.role },
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
    hoisted.role = "admin";
  });

  it("renders the focused provider catalogue without the removed production sections", async () => {
    render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Connections" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveTextContent("Connected");
    expect(screen.getByRole("article", { name: "Jira connection" })).toHaveTextContent("Not connected");
    expect(screen.getByRole("article", { name: "Slack connection" })).toHaveTextContent("Connected");
    expect(screen.queryByRole("heading", { name: "Monitoring sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evidence sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alert channels" })).not.toBeInTheDocument();
    expect(screen.queryByText("Local preview tools")).not.toBeInTheDocument();
    expect(screen.queryByText(/OAuth|SSO|Nango/i)).not.toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Section" });
    expect(within(tabs).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");
    expect(within(tabs).getByRole("link", { name: "Connections" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Old Jira")).not.toBeInTheDocument();
    expect(screen.queryByText("#old-alerts")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "GitHub App shadow collection" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install GitHub App" })).toHaveAttribute("href", "/api/github/setup");

    const expectedColumns: Record<string, string> = {
      integration_connections: "id,provider,label,config,connection_mode,enabled,created_at,revoked_at",
      alert_channels: "id,type,label,min_severity,enabled,daily_digest_enabled,created_at,revoked_at",
      github_installations: "id,account_login,status,repository_selection,permissions_ok,updated_at,revoked_at",
      github_repository_shadow_summaries: "repository_id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available,last_seen_at,latest_run_id,latest_trigger_type,latest_status,latest_diagnostic_code,latest_started_at,latest_completed_at,latest_observation_count,latest_passed_count,latest_failed_count,latest_unknown_count,latest_not_applicable_count,last_completed_collection_at",
    };
    expect(hoisted.selectCalls).toHaveLength(4);
    for (const call of hoisted.selectCalls) {
      expect(call.columns).toBe(expectedColumns[call.table]);
    }
  });

  it("scopes every connection dataset to the active workspace", async () => {
    await IntegrationsPage({ searchParams: Promise.resolve({}) });

    expect(hoisted.filterCalls).toEqual([
      { table: "integration_connections", column: "organisation_id", value: "org-1" },
      { table: "alert_channels", column: "organisation_id", value: "org-1" },
      { table: "github_installations", column: "organisation_id", value: "org-1" },
      { table: "github_repository_shadow_summaries", column: "organisation_id", value: "org-1" },
    ]);
  });

  it.each([
    "integration_connections", "alert_channels", "github_installations", "github_repository_shadow_summaries",
  ])("fails closed when %s cannot load", async (table) => {
    hoisted.errors[table] = { message: "query unavailable" };

    await expect(IntegrationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Could not load connection settings");
  });

  it("loads bounded delivery metadata for Owners without selecting message contents", async () => {
    hoisted.role = "owner";

    await IntegrationsPage({ searchParams: Promise.resolve({}) });

    expect(hoisted.selectCalls).toContainEqual({
      table: "daily_digest_deliveries",
      columns: "id,digest_on,channel_id,status,attempt_count,error_code,last_attempted_at,delivered_at",
    });
    expect(hoisted.filterCalls).toContainEqual({
      table: "daily_digest_deliveries",
      column: "organisation_id",
      value: "org-1",
    });
  });

  it("short-circuits Members before every GitHub query and action dependency", async () => {
    hoisted.role = "member";

    render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "connected" }) }));

    expect(hoisted.selectCalls).toEqual([]);
    expect(screen.queryByRole("heading", { name: "GitHub App shadow collection" })).not.toBeInTheDocument();
    expect(screen.getByText("Connections are managed by workspace Owners and Admins.")).toBeInTheDocument();
  });

  it("shows only the whitelisted GitHub connection success state", async () => {
    const { unmount } = render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "connected" }) }));
    expect(screen.getByRole("status", { name: "GitHub connection status" })).toHaveTextContent("GitHub App connected");
    unmount();

    render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "not_authorized" }) }));
    expect(screen.queryByText("GitHub App connected")).not.toBeInTheDocument();
  });
});
