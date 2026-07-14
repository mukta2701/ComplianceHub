import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  rows: {
    monitoring_findings: [{
      id: "finding-1", check_id: "branch-protection", control_ref: "A.8.32",
      subject_type: "github_repo", subject_id: "example/repo", severity: "high",
      title: "Branch protection disabled", detail: "Default branch is not protected.",
      status: "open", task_id: null, detected_at: "2026-01-03T00:00:00Z", resolved_at: null,
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
  for (const method of ["select", "eq", "is", "order", "limit"]) chain[method] = vi.fn(() => chain);
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
  it("retains operational monitoring and configuration controls for Admin", async () => {
    render(await MonitoringPage());

    for (const control of ["Run checks now", "Disconnect", "Connect source", "Acknowledge", "Raise task", "Resolve", "Add Slack channel"]) {
      expect(screen.getByRole("button", { name: control })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "Alert channels" })).toBeInTheDocument();
  });
});
