import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  rows: {
    monitoring_findings: [{
      id: "finding-1", check_id: "branch-protection", control_ref: "A.8.32",
      subject_type: "github_repo", subject_id: "example/repo", severity: "high",
      title: "Branch protection disabled", detail: "Default branch is not protected.",
      status: "open", task_id: null, detected_at: "2026-01-03T00:00:00Z", resolved_at: null,
    }, {
      id: "finding-resolved", check_id: "org-2fa", control_ref: "A.5.17",
      subject_type: "github_org", subject_id: "example", severity: "medium",
      title: "Resolved finding must stay hidden", detail: "This is historical.",
      status: "resolved", task_id: null, detected_at: "2026-01-01T00:00:00Z", resolved_at: "2026-01-02T00:00:00Z",
    }],
    monitor_sources: [{
      id: "source-1", provider: "github", label: "Production GitHub",
      config: { owner: "example", repo: "repo" },
    }],
    alert_channels: [],
  } as Record<string, unknown[]>,
}));

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
  it("shows active monitoring operations without configuration controls for Admin", async () => {
    render(await MonitoringPage());

    for (const control of ["Run checks now", "Acknowledge", "Raise task", "Resolve"]) {
      expect(screen.getByRole("button", { name: control })).toBeInTheDocument();
    }
    for (const configurationControl of ["Disconnect", "Connect source", "Add Slack channel"]) {
      expect(screen.queryByRole("button", { name: configurationControl })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "Alert channels" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connections and alerts" })).toHaveAttribute("href", "/app/integrations");
    expect(screen.queryByText("Resolved finding must stay hidden")).not.toBeInTheDocument();
  });
});
