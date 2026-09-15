import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  selectCalls: [] as Array<{ table: string; columns: string }>,
  filterCalls: [] as Array<{ table: string; column: string; value: string }>,
  serviceSelectCalls: [] as Array<{ table: string; columns: string }>,
  serviceFilterCalls: [] as Array<{ table: string; column: string; value: string }>,
  repositoryPageCalls: [] as Array<{ afterId: string | null; limit: number | null }>,
  createServiceClient: vi.fn(),
  errors: {} as Record<string, { message: string } | undefined>,
  controlRoomLoads: [] as unknown[],
  mappingReviewLoads: [] as unknown[],
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
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
      account_type: "Organization", provider_installation_id: 77, repository_selection: "selected", permissions_ok: true,
    }],
    github_connection_health_summaries: [{
      id: "10000000-0000-4000-8000-000000000010", health: "healthy", health_diagnostic_code: null,
      last_successful_reconciliation_at: "2026-09-15T11:55:00.000Z",
    }],
    github_connection_incidents: [{
      id: "10000000-0000-4000-8000-000000000014", installation_id: "10000000-0000-4000-8000-000000000010",
      diagnostic_code: "permission_mismatch", health: "owner_action_required",
      opened_at: "2026-09-15T10:00:00.000Z", last_observed_at: "2026-09-15T11:00:00.000Z",
    }],
    github_repositories: [{
      id: "10000000-0000-4000-8000-000000000011",
      organisation_id: "org-1",
      installation_id: "10000000-0000-4000-8000-000000000010",
      full_name: "Adtecher/compliancehub", html_url: "https://github.com/Adtecher/compliancehub",
      visibility: "private", default_branch: "main", archived: false, selected: true, available: true,
    }],
  } as Record<string, unknown[]>,
  serviceRows: {
    github_installations: [{
      id: "10000000-0000-4000-8000-000000000010",
      permissions: {
        metadata: "read", administration: "read", actions: "read", vulnerability_alerts: "read",
        security_events: "read", secret_scanning_alerts: "read",
      },
    }],
  } as Record<string, unknown[]>,
}));

function query(table: string, source: "authenticated" | "service" = "authenticated") {
  const selectCalls = source === "service" ? hoisted.serviceSelectCalls : hoisted.selectCalls;
  const filterCalls = source === "service" ? hoisted.serviceFilterCalls : hoisted.filterCalls;
  const chain: Record<string, unknown> = {};
  let afterId: string | null = null;
  let pageLimit: number | null = null;
  let repositoryOrganisationId: string | null = null;
  chain.select = vi.fn((columns: string) => {
    selectCalls.push({ table, columns });
    return chain;
  });
  chain.eq = vi.fn((column: string, value: string) => {
    filterCalls.push({ table, column, value });
    if (table === "github_repositories" && column === "organisation_id") repositoryOrganisationId = value;
    return chain;
  });
  for (const method of ["is", "order"]) chain[method] = vi.fn(() => chain);
  chain.gt = vi.fn((column: string, value: string) => {
    if (column === "id") afterId = value;
    return chain;
  });
  chain.limit = vi.fn((value: number) => {
    pageLimit = value;
    return chain;
  });
  chain.then = (resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown) =>
    Promise.resolve().then(() => {
      const sourceRows = (source === "service" ? hoisted.serviceRows : hoisted.rows)[table] ?? [];
      if (source === "authenticated" && table === "github_repositories") {
        hoisted.repositoryPageCalls.push({ afterId, limit: pageLimit });
        const rows = sourceRows
          .filter((row) => String((row as { organisation_id?: string }).organisation_id) === repositoryOrganisationId)
          .filter((row) => afterId === null || String((row as { id: string }).id) > afterId)
          .toSorted((left, right) => String((left as { id: string }).id).localeCompare(String((right as { id: string }).id)))
          .slice(0, Math.min(pageLimit ?? 1_000, 1_000));
        return { data: rows, error: hoisted.errors[table] ?? null };
      }
      return { data: sourceRows, error: hoisted.errors[`${source}:${table}`] ?? hoisted.errors[table] ?? null };
    }).then(resolve);
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
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: hoisted.createServiceClient }));
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
vi.mock("next/navigation", () => ({
  redirect: hoisted.redirect,
  usePathname: () => "/app/integrations",
  useRouter: () => ({ refresh: vi.fn() }),
}));

import IntegrationsPage from "./page";

describe("Settings Connections page", () => {
  beforeEach(() => {
    hoisted.selectCalls = [];
    hoisted.filterCalls = [];
    hoisted.serviceSelectCalls = [];
    hoisted.serviceFilterCalls = [];
    hoisted.repositoryPageCalls = [];
    hoisted.errors = {};
    hoisted.controlRoomLoads = [];
    hoisted.mappingReviewLoads = [];
    hoisted.redirect.mockClear();
    hoisted.createServiceClient.mockReset();
    hoisted.createServiceClient.mockReturnValue({ from: (table: string) => query(table, "service") });
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
    expect(screen.queryByRole("checkbox", { name: /include Adtecher\/compliancehub in monitoring/ })).not.toBeInTheDocument();
    expect(screen.getByText("Selected for ComplianceHub monitoring.")).toBeVisible();

    const expectedColumns: Record<string, string> = {
      integration_connections: "id,provider,label,config,connection_mode,enabled,created_at,revoked_at",
      alert_channels: "id,type,label,min_severity,enabled,daily_digest_enabled,created_at,revoked_at",
      github_installations: "id,account_login,account_type,provider_installation_id,status,repository_selection,permissions_ok",
      github_repositories: "id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available",
      github_connection_health_summaries: "id,health,health_diagnostic_code,last_successful_reconciliation_at",
      github_connection_incidents: "id,installation_id,diagnostic_code,health,opened_at,last_observed_at",
    };
    expect(hoisted.selectCalls).toHaveLength(6);
    for (const call of hoisted.selectCalls) {
      expect(call.columns).toBe(expectedColumns[call.table]);
      expect(call.columns).not.toMatch(/latest_|last_completed|failed_count/);
    }
    expect(hoisted.selectCalls.map((call) => call.table)).not.toContain("github_repository_shadow_summaries");
    expect(hoisted.serviceSelectCalls).toEqual([{ table: "github_installations", columns: "id,permissions" }]);
    expect(hoisted.serviceFilterCalls).toEqual([{ table: "github_installations", column: "organisation_id", value: "org-1" }]);
    expect(screen.getByText("Owner action required")).toBeVisible();
    expect(screen.queryByText("Healthy", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Connection incident: GitHub App permissions no longer match the approved read-only access.")).toBeVisible();
    expect(screen.getByText("Approved GitHub App permissions")).toBeVisible();
    expect(screen.getByText("Metadata — read")).toBeVisible();
    expect(screen.getByText("Administration — read")).toBeVisible();
    expect(screen.getByText("Actions — read")).toBeVisible();
    expect(screen.getByText("Vulnerability alerts — read")).toBeVisible();
    expect(screen.getByText("Security events — read")).toBeVisible();
    expect(screen.getByText("Secret scanning alerts — read")).toBeVisible();
    expect(screen.queryByText(/collection health|freshness|recheck/i)).not.toBeInTheDocument();
    expect(hoisted.controlRoomLoads).toHaveLength(0);
    expect(hoisted.mappingReviewLoads).toHaveLength(0);
  });

  it("scopes every connection dataset to the active workspace", async () => {
    await IntegrationsPage({ searchParams: Promise.resolve({}) });

    expect(hoisted.filterCalls).toHaveLength(6);
    for (const table of [
      "integration_connections", "alert_channels", "github_installations", "github_repositories",
      "github_connection_health_summaries", "github_connection_incidents",
    ]) {
      expect(hoisted.filterCalls).toContainEqual({ table, column: "organisation_id", value: "org-1" });
    }
  });

  it.each([
    "integration_connections", "alert_channels", "github_installations", "github_repositories",
    "github_connection_health_summaries", "github_connection_incidents",
  ])("fails closed when %s cannot load", async (table) => {
    hoisted.errors[table] = { message: "query unavailable" };

    await expect(IntegrationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Could not load connection settings");
  });

  it("fails closed when the server-only permission projection cannot load", async () => {
    hoisted.errors["service:github_installations"] = { message: "query unavailable" };

    await expect(IntegrationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Could not load connection settings");
  });

  it.each([
    ["missing health", (rows: Record<string, unknown[]>) => { rows.github_connection_health_summaries = []; }],
    ["duplicate health", (rows: Record<string, unknown[]>) => { rows.github_connection_health_summaries = [...rows.github_connection_health_summaries, rows.github_connection_health_summaries[0]!]; }],
    ["misaligned health", (rows: Record<string, unknown[]>) => { rows.github_connection_health_summaries = [{ ...(rows.github_connection_health_summaries[0] as Record<string, unknown>), id: "10000000-0000-4000-8000-000000000099" }]; }],
  ])("fails closed for %s connection-health rows", async (_label, mutate) => {
    const original = hoisted.rows.github_connection_health_summaries;
    try {
      mutate(hoisted.rows);
      await expect(IntegrationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Could not load connection settings");
    } finally {
      hoisted.rows.github_connection_health_summaries = original;
    }
  });

  it.each([
    ["missing", (rows: Record<string, unknown[]>) => { rows.github_installations = []; }],
    ["duplicate", (rows: Record<string, unknown[]>) => { rows.github_installations = [...rows.github_installations, rows.github_installations[0]!]; }],
    ["misaligned", (rows: Record<string, unknown[]>) => { rows.github_installations = [{ ...(rows.github_installations[0] as Record<string, unknown>), id: "10000000-0000-4000-8000-000000000099" }]; }],
  ])("fails closed for %s server-only permission rows", async (_label, mutate) => {
    const original = hoisted.serviceRows.github_installations;
    try {
      mutate(hoisted.serviceRows);
      await expect(IntegrationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Could not load connection settings");
    } finally {
      hoisted.serviceRows.github_installations = original;
    }
  });

  it("fails closed to permission mismatch when the raw permission projection is not exact", async () => {
    const originalPermissions = (hoisted.serviceRows.github_installations[0] as { permissions: Record<string, string> }).permissions;
    const originalIncidents = hoisted.rows.github_connection_incidents;
    try {
      (hoisted.serviceRows.github_installations[0] as { permissions: Record<string, string> }).permissions = { ...originalPermissions, contents: "read" };
      hoisted.rows.github_connection_incidents = [];
      render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));
      expect(screen.getByText("Owner action required")).toBeVisible();
      expect(screen.getAllByRole("status")[0]).toHaveTextContent("GitHub App permissions no longer match the approved read-only access.");
      expect(screen.queryByText("Approved GitHub App permissions")).not.toBeInTheDocument();
    } finally {
      (hoisted.serviceRows.github_installations[0] as { permissions: Record<string, string> }).permissions = originalPermissions;
      hoisted.rows.github_connection_incidents = originalIncidents;
    }
  });

  it("treats a false stored permission flag with exact raw permissions as generic Owner review", async () => {
    const originalInstallations = hoisted.rows.github_installations;
    const originalIncidents = hoisted.rows.github_connection_incidents;
    try {
      hoisted.rows.github_installations = [{ ...(originalInstallations[0] as Record<string, unknown>), permissions_ok: false }];
      hoisted.rows.github_connection_incidents = [];
      render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));
      expect(screen.getByText("Owner action required")).toBeVisible();
      expect(screen.getAllByRole("status")[0]).toHaveTextContent("GitHub access needs a workspace Owner to review it.");
      expect(screen.queryByText("GitHub App permissions no longer match the approved read-only access.")).not.toBeInTheDocument();
      expect(screen.queryByText("Approved GitHub App permissions")).not.toBeInTheDocument();
    } finally {
      hoisted.rows.github_installations = originalInstallations;
      hoisted.rows.github_connection_incidents = originalIncidents;
    }
  });

  it("preserves an account mismatch over generic unsafe facts without approving the connected hint", async () => {
    const originalInstallations = hoisted.rows.github_installations;
    const originalHealth = hoisted.rows.github_connection_health_summaries;
    const originalIncidents = hoisted.rows.github_connection_incidents;
    try {
      hoisted.rows.github_installations = [{ ...(originalInstallations[0] as Record<string, unknown>), status: "needs_attention", permissions_ok: false }];
      hoisted.rows.github_connection_health_summaries = [{ ...(originalHealth[0] as Record<string, unknown>), health: "owner_action_required", health_diagnostic_code: "account_mismatch" }];
      hoisted.rows.github_connection_incidents = [{ ...(originalIncidents[0] as Record<string, unknown>), health: "owner_action_required", diagnostic_code: "account_mismatch" }];
      render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "connected" }) }));
      expect(screen.getByText("Owner action required")).toBeVisible();
      expect(screen.getAllByRole("status")[0]).toHaveTextContent("The connected GitHub account no longer matches this workspace.");
      expect(screen.getByText("Connection incident: The connected GitHub account no longer matches this workspace.")).toBeVisible();
      expect(screen.queryByText("GitHub App permissions no longer match the approved read-only access.")).not.toBeInTheDocument();
      expect(screen.queryByText("Approved GitHub App permissions")).not.toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "GitHub connection status" })).not.toBeInTheDocument();
    } finally {
      hoisted.rows.github_installations = originalInstallations;
      hoisted.rows.github_connection_health_summaries = originalHealth;
      hoisted.rows.github_connection_incidents = originalIncidents;
    }
  });

  it("uses an open incident over a conflicting healthy summary", async () => {
    render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Owner action required")).toBeVisible();
    expect(screen.queryByText("Healthy", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Connection incident: GitHub App permissions no longer match the approved read-only access.")).toBeVisible();
  });

  it("suppresses a weaker open incident when revoked status resolves as disconnected", async () => {
    const originalInstallations = hoisted.rows.github_installations;
    const originalIncidents = hoisted.rows.github_connection_incidents;
    try {
      hoisted.rows.github_installations = [{ ...(originalInstallations[0] as Record<string, unknown>), status: "revoked" }];
      hoisted.rows.github_connection_incidents = [{
        ...(originalIncidents[0] as Record<string, unknown>), health: "retrying", diagnostic_code: "provider_temporary_failure",
      }];
      render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));
      expect(screen.getByText("Disconnected")).toBeVisible();
      expect(screen.queryByText(/Connection incident: ComplianceHub cannot currently verify GitHub access/i)).not.toBeInTheDocument();
    } finally {
      hoisted.rows.github_installations = originalInstallations;
      hoisted.rows.github_connection_incidents = originalIncidents;
    }
  });

  it("loads every repository page so an Owner can manage scope beyond the PostgREST ceiling", async () => {
    const originalRepositories = hoisted.rows.github_repositories;
    const originalIncidents = hoisted.rows.github_connection_incidents;
    try {
      hoisted.role = "owner";
      hoisted.rows.github_connection_incidents = [];
      const idFor = (number: number) => `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
      hoisted.rows.github_repositories = [
        ...Array.from({ length: 1_001 }, (_, index) => ({
        id: idFor(index + 1),
        organisation_id: "org-1",
        installation_id: "10000000-0000-4000-8000-000000000010",
        full_name: index === 0 ? "Adtecher/z-last-by-name" : index === 1_000 ? "Adtecher/a-first-by-name" : `Adtecher/repository-${String(index + 1).padStart(5, "0")}`,
        html_url: `https://github.com/Adtecher/repository-${String(index + 1).padStart(5, "0")}`,
        visibility: "private", default_branch: "main", archived: false, selected: index === 1_000, available: true,
        })),
        {
          id: "10000000-0000-4000-8000-000000000001", organisation_id: "other-org",
          installation_id: "10000000-0000-4000-8000-000000000010", full_name: "Other/leaked-repository",
          html_url: "https://github.com/Other/leaked-repository", visibility: "private", default_branch: "main",
          archived: false, selected: true, available: true,
        },
      ];
      render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));
      expect(screen.getByText("1001 repositories available to this GitHub App; 1 selected in ComplianceHub.")).toBeVisible();
      expect(screen.getByRole("checkbox", { name: "Allow ComplianceHub to read and include Adtecher/a-first-by-name in monitoring" })).toBeEnabled();
      expect(screen.getAllByRole("checkbox")[0]).toHaveAccessibleName("Allow ComplianceHub to read and include Adtecher/a-first-by-name in monitoring");
      expect(screen.queryByText("Other/leaked-repository")).not.toBeInTheDocument();
      expect(hoisted.repositoryPageCalls).toEqual([
        { afterId: null, limit: 500 },
        { afterId: idFor(500), limit: 500 },
        { afterId: idFor(1_000), limit: 500 },
      ]);
      expect(hoisted.filterCalls.filter((call) => call.table === "github_repositories")).toEqual([
        { table: "github_repositories", column: "organisation_id", value: "org-1" },
        { table: "github_repositories", column: "organisation_id", value: "org-1" },
        { table: "github_repositories", column: "organisation_id", value: "org-1" },
      ]);
    } finally {
      hoisted.rows.github_repositories = originalRepositories;
      hoisted.rows.github_connection_incidents = originalIncidents;
    }
  });

  it("fails closed after one bounded probe beyond the 10000 repository contract", async () => {
    const originalRepositories = hoisted.rows.github_repositories;
    try {
      const idFor = (number: number) => `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
      hoisted.rows.github_repositories = Array.from({ length: 10_001 }, (_, index) => ({
        id: idFor(index + 1),
        organisation_id: "org-1",
        installation_id: "10000000-0000-4000-8000-000000000010",
        full_name: `Adtecher/repository-${String(index + 1).padStart(5, "0")}`,
        html_url: `https://github.com/Adtecher/repository-${String(index + 1).padStart(5, "0")}`,
        visibility: "private", default_branch: "main", archived: false, selected: false, available: true,
      }));
      await expect(IntegrationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Could not load connection settings");
      expect(hoisted.repositoryPageCalls.at(-1)).toEqual({ afterId: idFor(10_000), limit: 1 });
    } finally {
      hoisted.rows.github_repositories = originalRepositories;
    }
  });

  it("constructs Owner settings links under the fixed GitHub origin only for organisations", async () => {
    const original = hoisted.rows.github_installations;
    try {
      hoisted.role = "owner";
      hoisted.rows.github_installations = [{ ...(original[0] as Record<string, unknown>), account_login: "evil.example/path?x=1" }];
      render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));
      expect(screen.getByRole("link", { name: "Open GitHub installation settings" })).toHaveAttribute(
        "href", "https://github.com/organizations/evil.example%2Fpath%3Fx%3D1/settings/installations/77",
      );
    } finally {
      hoisted.rows.github_installations = original;
    }
  });

  it("does not render an installation settings link for non-organisation accounts", async () => {
    const original = hoisted.rows.github_installations;
    try {
      hoisted.role = "owner";
      hoisted.rows.github_installations = [{ ...(original[0] as Record<string, unknown>), account_type: "User" }];
      render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));
      expect(screen.queryByRole("link", { name: "Open GitHub installation settings" })).not.toBeInTheDocument();
    } finally {
      hoisted.rows.github_installations = original;
    }
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

  it("redirects Members before any GitHub connection or incident query", async () => {
    hoisted.role = "member";

    await expect(IntegrationsPage({ searchParams: Promise.resolve({ github: "connected" }) })).rejects.toThrow("redirect:/app");
    expect(hoisted.redirect).toHaveBeenCalledWith("/app");
    expect(hoisted.selectCalls).toHaveLength(0);
    expect(hoisted.createServiceClient).not.toHaveBeenCalled();
  });

  it("allows only Owners to change repository scope", async () => {
    hoisted.role = "owner";
    render(await IntegrationsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("checkbox", { name: /include Adtecher\/compliancehub in monitoring/ })).toBeEnabled();
    expect(screen.queryByRole("group", { name: "Owner mapping approval" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open GitHub monitoring" })).toHaveAttribute("href", "/app/monitoring");
  });

  it("shows the connected hint only for an assembled active, verified connection", async () => {
    const originalIncidents = hoisted.rows.github_connection_incidents;
    try {
      hoisted.rows.github_connection_incidents = [];
      render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "connected" }) }));
      expect(screen.getByRole("status", { name: "GitHub connection status" })).toHaveTextContent("GitHub repository access connected");
    } finally {
      hoisted.rows.github_connection_incidents = originalIncidents;
    }
  });

  it.each([
    ["there are no installations", () => {
      hoisted.rows.github_installations = [];
      hoisted.rows.github_connection_health_summaries = [];
      hoisted.rows.github_connection_incidents = [];
      hoisted.serviceRows.github_installations = [];
    }],
    ["the installation is revoked", () => {
      hoisted.rows.github_installations = [{ ...(hoisted.rows.github_installations[0] as Record<string, unknown>), status: "revoked" }];
      hoisted.rows.github_connection_incidents = [];
    }],
    ["the installation is suspended", () => {
      hoisted.rows.github_installations = [{ ...(hoisted.rows.github_installations[0] as Record<string, unknown>), status: "suspended" }];
      hoisted.rows.github_connection_incidents = [];
    }],
    ["raw permissions are not exact", () => {
      hoisted.serviceRows.github_installations = [{ ...(hoisted.serviceRows.github_installations[0] as Record<string, unknown>), permissions: { metadata: "read" } }];
      hoisted.rows.github_connection_incidents = [];
    }],
  ])("does not trust the connected hint when %s", async (_label, mutate) => {
    const originalRows = { ...hoisted.rows };
    const originalServiceRows = { ...hoisted.serviceRows };
    try {
      mutate();
      render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "connected" }) }));
      expect(screen.queryByRole("status", { name: "GitHub connection status" })).not.toBeInTheDocument();
    } finally {
      hoisted.rows = originalRows;
      hoisted.serviceRows = originalServiceRows;
    }
  });

  it("ignores unrecognised GitHub query hints", async () => {
    render(await IntegrationsPage({ searchParams: Promise.resolve({ github: "not_authorized" }) }));
    expect(screen.queryByText("GitHub repository access connected")).not.toBeInTheDocument();
  });
});
