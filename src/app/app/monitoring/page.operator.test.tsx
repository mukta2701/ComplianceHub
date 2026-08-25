import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loadOfficial: vi.fn().mockResolvedValue([]),
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
    alert_channels: [],
  } as Record<string, unknown[]>,
}));

vi.mock("@/features/github/application/github-record-provenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/github/application/github-record-provenance")>();
  return { ...actual, loadOfficialGitHubFindingProvenance: hoisted.loadOfficial };
});

function query(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: (table: string) => query(hoisted.rows[table] ?? []) },
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
  it("shows monitoring operations but hides owner-only finding controls for Admin", async () => {
    render(await MonitoringPage());

    expect(screen.getByRole("button", { name: "Run checks now" })).toBeInTheDocument();
    for (const control of ["Acknowledge", "Raise task", "Resolve"]) {
      expect(screen.queryByRole("button", { name: control })).not.toBeInTheDocument();
    }
    for (const configurationControl of ["Disconnect", "Connect source", "Add Slack channel"]) {
      expect(screen.queryByRole("button", { name: configurationControl })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "Alert channels" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connections and alerts" })).toHaveAttribute("href", "/app/integrations");
    for (const visible of ["Remediation underway", "Exception requested", "Risk accepted"]) {
      expect(screen.getByText(visible)).toBeInTheDocument();
    }
    expect(screen.queryByText("Resolved finding must stay hidden")).not.toBeInTheDocument();
  });
});
