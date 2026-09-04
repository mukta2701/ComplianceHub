import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  selectCalls: [] as Array<{ table: string; columns: string }>,
  filterCalls: [] as Array<{ table: string; column: string; value: string }>,
  errors: {} as Record<string, { message: string } | undefined>,
  controlRoomLoads: [] as unknown[],
  mappingReviewLoads: [] as unknown[],
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
      repository_selection: "selected", permissions_ok: true,
    }],
    github_repositories: [{
      id: "10000000-0000-4000-8000-000000000011",
      installation_id: "10000000-0000-4000-8000-000000000010",
      full_name: "Adtecher/compliancehub", html_url: "https://github.com/Adtecher/compliancehub",
      visibility: "private", default_branch: "main", archived: false, selected: true, available: true,
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
    supabase: {
      from: (table: string) => query(table),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    },
    organisation: { id: "org-1", name: "Example Ltd" },
    membership: { role: hoisted.role },
    user: { id: "user-1", email: "admin@example.test" },
  }),
}));
vi.mock("@/features/github/application/github-compliance-control-room", () => ({
  GITHUB_MATERIALISATION_RETRY_REASON_CODES: ["configuration_corrected", "provider_recovered", "owner_reviewed"],
  retryGitHubMaterialisationJob: vi.fn(),
  loadGitHubComplianceControlRoom: (...args: unknown[]) => {
    hoisted.controlRoomLoads.push(args);
    return Promise.resolve({
      schemaVersion: 1,
      workspaceId: "org-1",
      asOf: "2026-08-25T12:00:00.000Z",
      approval: null,
      pagination: { offset: 0, limit: 20, total: 0, truncated: false },
      repositories: [],
      exhaustedAttention: { total: 0, truncated: false, items: [] },
    });
  },
}));
vi.mock("@/features/github/application/github-mapping-review", () => ({
  loadGitHubMappingReview: (...args: unknown[]) => {
    hoisted.mappingReviewLoads.push(args);
    return Promise.resolve({
      pack: {
        id: "91000000-0000-4000-8000-000000000001",
        version: "github-iso-27001-v1",
        title: "Standard GitHub to ISO/IEC 27001:2022 mapping pack",
        checksum: "b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f",
        publishedAt: "2026-08-24T12:00:00.000Z",
      },
      entries: [],
      approvalHistory: [],
      limitations: [
        "These repository checks cover selected technical signals only; they do not certify ISO/IEC 27001 compliance.",
      ],
    });
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/integrations", useRouter: () => ({ refresh: vi.fn() }) }));

import IntegrationsPage from "./page";

describe("Settings Connections page", () => {
  beforeEach(() => {
    hoisted.selectCalls = [];
    hoisted.filterCalls = [];
    hoisted.errors = {};
    hoisted.controlRoomLoads = [];
    hoisted.mappingReviewLoads = [];
    hoisted.role = "admin";
  });

  it("renders the focused provider catalogue without the removed production sections", async () => {
    render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Connections" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "GitHub Issues connection" })).toHaveTextContent("Connected");
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
    expect(screen.getByRole("heading", { name: "GitHub repository access" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "From repository facts to reviewed records" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up repository access" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /include Adtecher\/compliancehub in monitoring/ })).toBeDisabled();

    const expectedColumns: Record<string, string> = {
      integration_connections: "id,provider,label,config,connection_mode,enabled,created_at,revoked_at",
      alert_channels: "id,type,label,min_severity,enabled,daily_digest_enabled,created_at,revoked_at",
      github_installations: "id,account_login,status,repository_selection,permissions_ok",
      github_repositories: "id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available",
    };
    expect(hoisted.selectCalls).toHaveLength(4);
    for (const call of hoisted.selectCalls) {
      expect(call.columns).toBe(expectedColumns[call.table]);
      expect(call.columns).not.toMatch(/latest_|last_completed|failed_count/);
    }
    expect(hoisted.selectCalls.map((call) => call.table)).not.toContain("github_repository_shadow_summaries");
    expect(screen.queryByText(/collection health|freshness|recheck/i)).not.toBeInTheDocument();
    expect(hoisted.controlRoomLoads).toHaveLength(0);
    expect(hoisted.mappingReviewLoads).toHaveLength(0);
  });

  it("scopes every connection dataset to the active workspace", async () => {
    await IntegrationsPage({ searchParams: Promise.resolve({}) });

    expect(hoisted.filterCalls).toEqual([
      { table: "integration_connections", column: "organisation_id", value: "org-1" },
      { table: "alert_channels", column: "organisation_id", value: "org-1" },
      { table: "github_installations", column: "organisation_id", value: "org-1" },
      { table: "github_repositories", column: "organisation_id", value: "org-1" },
    ]);
  });

  it.each([
    "integration_connections", "alert_channels", "github_installations", "github_repositories",
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

  it("gives Members only the safe GitHub read view with repository scope disabled", async () => {
    hoisted.role = "member";

    render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "connected" }) }));

    expect(hoisted.selectCalls.map((call) => call.table)).toEqual([
      "github_installations",
      "github_repositories",
    ]);
    expect(screen.getByRole("heading", { name: "GitHub repository access" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /include Adtecher\/compliancehub in monitoring/ })).toBeDisabled();
    expect(screen.queryByRole("article", { name: "Slack connection" })).not.toBeInTheDocument();
    expect(screen.queryByText("GitHub repository access connected.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "From repository facts to reviewed records" })).not.toBeInTheDocument();
    expect(hoisted.controlRoomLoads).toHaveLength(0);
    expect(hoisted.mappingReviewLoads).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Open GitHub monitoring" })).toHaveAttribute("href", "/app/monitoring");
  });

  it("allows only Owners to change repository scope", async () => {
    hoisted.role = "owner";
    render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("checkbox", { name: /include Adtecher\/compliancehub in monitoring/ })).toBeEnabled();
    expect(screen.queryByRole("group", { name: "Owner mapping approval" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open GitHub monitoring" })).toHaveAttribute("href", "/app/monitoring");
  });

  it("shows only the whitelisted GitHub connection success state", async () => {
    const { unmount } = render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "connected" }) }));
    expect(screen.getByRole("status", { name: "GitHub connection status" })).toHaveTextContent("GitHub repository access connected");
    unmount();

    render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "not_authorized" }) }));
    expect(screen.queryByText("GitHub repository access connected")).not.toBeInTheDocument();
  });
});
