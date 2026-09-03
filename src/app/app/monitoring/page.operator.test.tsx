import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loadOfficial: vi.fn().mockResolvedValue([]),
  controlRoomLoads: [] as unknown[][],
  mappingReviewLoads: [] as unknown[][],
  tables: [] as string[],
  rows: {
    monitoring_findings: [{
      id: "41000000-0000-4000-8000-000000000001", control_ref: "A.8.32",
      subject_id: "example/repo", severity: "high",
      title: "Branch protection disabled", detail: "Default branch is not protected.",
      status: "open", task_id: null, detected_at: "2026-01-03T00:00:00Z", finding_origin: "legacy",
    }, {
      id: "41000000-0000-4000-8000-000000000002", control_ref: "A.8.32",
      subject_id: "example/repo", severity: "medium",
      title: "Remediation underway", detail: "The condition remains active.",
      status: "in_progress", task_id: null, detected_at: "2026-01-02T00:00:00Z", finding_origin: "legacy",
    }, {
      id: "41000000-0000-4000-8000-000000000003", control_ref: "A.8.32",
      subject_id: "example/repo", severity: "medium",
      title: "Exception requested", detail: "The condition remains active.",
      status: "exception_requested", task_id: null, detected_at: "2026-01-02T00:00:00Z", finding_origin: "legacy",
    }, {
      id: "41000000-0000-4000-8000-000000000004", control_ref: "A.8.32",
      subject_id: "example/repo", severity: "medium",
      title: "Risk accepted", detail: "The condition remains active.",
      status: "risk_accepted", task_id: null, detected_at: "2026-01-02T00:00:00Z", finding_origin: "legacy",
    }, {
      id: "41000000-0000-4000-8000-000000000005", control_ref: "A.5.17",
      subject_id: "example", severity: "medium",
      title: "Resolved finding must stay hidden", detail: "This is historical.",
      status: "resolved", task_id: null, detected_at: "2026-01-01T00:00:00Z", finding_origin: "legacy",
    }],
    monitor_sources: [{
      id: "42000000-0000-4000-8000-000000000001", provider: "github", label: "Production GitHub",
      created_at: "2026-01-01T00:00:00Z",
    }],
    github_installations: [{
      id: "43000000-0000-4000-8000-000000000001", account_login: "ExampleOrg", status: "active",
      repository_selection: "selected", permissions_ok: true,
    }],
    github_repository_monitoring_summaries: [{
      repository_id: "43000000-0000-4000-8000-000000000002",
      installation_id: "43000000-0000-4000-8000-000000000001", full_name: "ExampleOrg/compliance",
      html_url: "https://github.com/ExampleOrg/compliance", selected: true, available: true,
      latest_run_id: null, latest_status: null, latest_failed_count: null, last_completed_collection_at: null,
    }],
    alert_channels: [],
  } as Record<string, unknown[]>,
}));

vi.mock("@/features/github/application/github-record-provenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/github/application/github-record-provenance")>();
  return { ...actual, loadOfficialGitHubFindingProvenance: hoisted.loadOfficial };
});
vi.mock("@/features/github/application/github-compliance-control-room", () => ({
  loadGitHubComplianceControlRoom: (...args: unknown[]) => {
    hoisted.controlRoomLoads.push(args);
    return Promise.resolve({
      schemaVersion: 1, workspaceId: "org-1", asOf: "2026-08-25T12:00:00.000Z", approval: null,
      pagination: { offset: 0, limit: 20, total: 0, truncated: false }, repositories: [],
      exhaustedAttention: { total: 0, truncated: false, items: [] },
    });
  },
}));
vi.mock("@/features/github/application/github-mapping-review", () => ({
  loadGitHubMappingReview: (...args: unknown[]) => {
    hoisted.mappingReviewLoads.push(args);
    return Promise.resolve({ pack: {}, entries: [], approvalHistory: [], limitations: [] });
  },
}));
vi.mock("@/features/github/components/github-compliance-control-room", () => ({
  GitHubComplianceControlRoomPanel: ({ role }: { role: string }) => <section aria-label="Technical GitHub review">Raw check ID · {role}</section>,
}));
vi.mock("@/features/github/components/github-collection-health-panel", () => ({
  GitHubCollectionHealthPanel: ({ role }: { role: string }) =>
    <section aria-label="GitHub monitoring"><h2>GitHub monitoring</h2>{role === "owner" ? "Owner check" : "Read-only monitoring"}</section>,
}));

function query(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: (table: string) => { hoisted.tables.push(table); return query(hoisted.rows[table] ?? []); } },
    organisation: { id: "org-1", name: "Example Ltd" },
    membership: { role: "admin" },
  }),
}));
vi.mock("@/features/monitoring/application/monitor-registry", () => ({
  resolveMonitorProvider: () => ({
    runChecks: () => Promise.resolve([{ checkId: "branch-protection", passed: true, severity: "high" }]),
  }),
}));

import MonitoringPage from "./page";

describe("operator monitoring page", () => {
  beforeEach(() => {
    hoisted.controlRoomLoads = [];
    hoisted.mappingReviewLoads = [];
    hoisted.tables = [];
  });

  it("shows monitoring operations but hides owner-only finding controls for Admin", async () => {
    render(await MonitoringPage());

    expect(screen.queryByRole("button", { name: "Run checks now" })).not.toBeInTheDocument();
    for (const control of ["Acknowledge", "Raise task", "Resolve"]) {
      expect(screen.queryByRole("button", { name: control })).not.toBeInTheDocument();
    }
    for (const configurationControl of ["Disconnect", "Connect source", "Add Slack channel"]) {
      expect(screen.queryByRole("button", { name: configurationControl })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "Alert channels" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connections and alerts" })).toHaveAttribute("href", "/app/integrations");
    expect(screen.getByRole("region", { name: "GitHub monitoring" })).toHaveTextContent("Read-only monitoring");
    expect(hoisted.tables).toContain("github_repository_monitoring_summaries");
    expect(hoisted.tables).not.toContain("github_repository_shadow_summaries");
    expect(hoisted.controlRoomLoads).toEqual([[expect.anything(), { organisationId: "org-1", offset: 0, limit: 20 }]]);
    expect(hoisted.mappingReviewLoads).toEqual([[expect.anything(), "org-1"]]);
    for (const visible of ["Remediation underway", "Exception requested", "Risk accepted"]) {
      expect(screen.getByText(visible)).toBeInTheDocument();
    }
    expect(screen.queryByText("Resolved finding must stay hidden")).not.toBeInTheDocument();
  });

  it("shows a truthful summary and orders user-facing monitoring before closed technical review", async () => {
    render(await MonitoringPage());

    expect(screen.getByText("4 active findings").closest(".monitor-banner")).toHaveTextContent("1 system monitored");
    expect(screen.queryByText("0 systems monitored")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connected systems" })).not.toBeInTheDocument();

    const summary = screen.getByText("4 active findings").closest(".monitor-banner");
    const github = screen.getByRole("region", { name: "GitHub monitoring" });
    const findings = screen.getByRole("heading", { name: "Active findings" }).closest("section, article, div");
    const technicalSummary = screen.getByText("Technical review and recovery");
    const technicalDetails = technicalSummary.closest("details");
    expect(summary).not.toBeNull();
    expect(findings).not.toBeNull();
    expect(technicalDetails).not.toBeNull();
    expect(technicalDetails).not.toHaveAttribute("open");
    expect(technicalDetails).toContainElement(screen.getByRole("region", { name: "Technical GitHub review" }));
    expect(summary!.compareDocumentPosition(github) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(github.compareDocumentPosition(findings!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(findings!.compareDocumentPosition(technicalDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses neutral zero-findings wording even when GitHub is connected", async () => {
    const current = hoisted.rows.monitoring_findings;
    hoisted.rows.monitoring_findings = [];
    try {
      render(await MonitoringPage());
      expect(screen.getByText("No recorded active findings")).toBeVisible();
      expect(screen.queryByText("No active findings")).not.toBeInTheDocument();
      const banner = screen.getByText("No recorded active findings").closest(".monitor-banner");
      expect(banner).toHaveTextContent("1 system monitored");
      expect(banner).toHaveTextContent("Monitoring status is not yet confirmed.");
      expect(banner?.querySelector(".monitor-dot")).toHaveClass("neutral");
      expect(banner?.querySelector(".monitor-dot")).not.toHaveClass("ok");
    } finally {
      hoisted.rows.monitoring_findings = current;
    }
  });

  it("counts an active GitHub installation even when its permissions need attention", async () => {
    const current = hoisted.rows.github_installations;
    hoisted.rows.github_installations = [{ ...(current[0] as Record<string, unknown>), permissions_ok: false }];
    try {
      render(await MonitoringPage());
      expect(screen.getByText("4 active findings").closest(".monitor-banner")).toHaveTextContent("1 system monitored");
    } finally {
      hoisted.rows.github_installations = current;
    }
  });

  it("places other monitored systems after findings and preserves the de-duplicated count", async () => {
    const current = hoisted.rows.monitor_sources;
    hoisted.rows.monitor_sources = [...current, {
      id: "42000000-0000-4000-8000-000000000002", provider: "slack", label: "Security alerts",
      created_at: "2026-01-02T00:00:00Z",
    }];
    try {
      render(await MonitoringPage());
      const findings = screen.getByRole("heading", { name: "Active findings" });
      const otherSystems = screen.getByRole("heading", { name: "Other monitored systems" });
      const technical = screen.getByText("Technical review and recovery").closest("details");
      const monitoringPage = findings.closest(".monitoring-page");
      expect(monitoringPage).not.toBeNull();
      expect(findings.closest(".monitor-findings-card")).not.toBeNull();
      expect(otherSystems.closest(".monitor-other-systems-card")).not.toBeNull();
      expect(screen.getByText("4 active findings").closest(".monitor-banner")).toHaveTextContent("2 systems monitored");
      expect(findings.compareDocumentPosition(otherSystems) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(otherSystems.compareDocumentPosition(technical!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      hoisted.rows.monitor_sources = current;
    }
  });

  it("keeps GitHub repository pagination in Monitoring", async () => {
    await MonitoringPage({ searchParams: Promise.resolve({ githubPage: "3" }) });
    expect(hoisted.controlRoomLoads).toEqual([[expect.anything(), { organisationId: "org-1", offset: 40, limit: 20 }]]);
  });
});
