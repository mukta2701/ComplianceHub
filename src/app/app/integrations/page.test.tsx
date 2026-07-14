import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  selectCalls: [] as Array<{ table: string; columns: string }>,
  filterCalls: [] as Array<{ table: string; column: string; value: string }>,
  errors: {} as Record<string, { message: string } | undefined>,
  rows: {
    integration_connections: [{
      id: "connection-1", provider: "github", label: "GitHub", config: {},
      connection_mode: "oauth", enabled: false, created_at: "2026-07-14T00:00:00Z", revoked_at: null,
    }],
    monitor_sources: [{
      id: "source-1", provider: "github", label: "Production repository",
      config: { owner: "acme", repo: "isms" }, enabled: true,
      connection_mode: "oauth", integration_connection_id: "connection-1",
      created_at: "2026-07-14T00:00:00Z", revoked_at: null,
    }, {
      id: "source-2", provider: "github", label: "Sandbox repository",
      config: { owner: "acme", repo: "sandbox" }, enabled: true,
      connection_mode: "sandbox", integration_connection_id: null,
      created_at: "2026-07-14T00:00:00Z", revoked_at: null,
    }],
    alert_channels: [{
      id: "channel-1", type: "slack", label: "#compliance-alerts", min_severity: "high",
      enabled: true, created_at: "2026-07-14T00:00:00Z", revoked_at: null,
    }],
    evidence_sources: [],
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

  it("puts systems and alert-channel configuration in one operator workspace", async () => {
    render(await IntegrationsPage());

    expect(screen.getByRole("heading", { name: "Systems" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect GitHub with OAuth" })).toBeInTheDocument();
    expect(screen.getByText("GitHub Issues plus branch, review, secret-scanning and organisation MFA checks.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Jira with OAuth" })).toBeInTheDocument();
    expect(screen.getByText("Authorized · setup required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save target and enable GitHub connection" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Monitoring sources" })).toBeInTheDocument();
    expect(screen.getByText("Production repository")).toBeInTheDocument();
    expect(screen.getByText("Managed by its GitHub connection")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable Production repository" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable Sandbox repository" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Alert channels" })).toBeInTheDocument();
    expect(screen.getByText("In-app notifications")).toBeInTheDocument();
    expect(screen.getByText("Always on")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Slack channel" })).toBeInTheDocument();
    expect(screen.getByText("Local sandbox / developer setup")).toBeInTheDocument();

    const expectedColumns: Record<string, string> = {
      integration_connections: "id,provider,label,config,connection_mode,enabled,created_at,revoked_at",
      monitor_sources: "id,provider,label,config,enabled,connection_mode,integration_connection_id,created_at,revoked_at",
      alert_channels: "id,type,label,min_severity,enabled,created_at,revoked_at",
      evidence_sources: "id,provider,label,config,created_at,revoked_at",
    };
    for (const call of hoisted.selectCalls) {
      expect(call.columns).toBe(expectedColumns[call.table]);
    }
  });

  it("scopes every connection dataset to the active workspace", async () => {
    await IntegrationsPage();

    expect(hoisted.filterCalls).toEqual([
      { table: "integration_connections", column: "organisation_id", value: "org-1" },
      { table: "monitor_sources", column: "organisation_id", value: "org-1" },
      { table: "alert_channels", column: "organisation_id", value: "org-1" },
      { table: "evidence_sources", column: "organisation_id", value: "org-1" },
    ]);
  });

  it("fails closed instead of rendering a false empty state when a dataset cannot load", async () => {
    hoisted.errors.monitor_sources = { message: "query unavailable" };

    await expect(IntegrationsPage()).rejects.toThrow("Could not load connection settings");
  });
});
