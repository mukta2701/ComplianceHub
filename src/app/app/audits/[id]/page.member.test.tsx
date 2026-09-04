import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => [] as string[]);

function query(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  chain.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null });
  return chain;
}

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1" },
    membership: { role: "member" },
    supabase: { from: (table: string) => {
      tables.push(table);
      const rows: Record<string, unknown[]> = {
        audits: [{ id: "audit-1", reference: "AUD-001", title: "Access review", scope: "Access controls", status: "planned", framework: "ISO 27001", planned_start: null, planned_end: null }],
        audit_checklist_items: [{ id: "item-1", area: "Access", clause_reference: "A.5", checklist_item: "Review access", compliant: "compliant", evidence_note: "Evidence", findings: "" }],
        audit_findings: [{ id: "finding-1", summary: "Expired account", severity: "minor_nc", status: "open", corrective_action: "Disable account", task_id: "task-1" }],
        memberships: [],
        auditor_access_tokens: [],
        ai_workspace_settings: [],
        auditor_access_log: [],
      };
      return query(rows[table] ?? []);
    } },
  }),
}));
vi.mock("../actions", () => ({ updateAuditStatusAction: vi.fn(), addChecklistItemAction: vi.fn(), populateAuditChecklistAction: vi.fn(), updateChecklistItemAction: vi.fn(), raiseFindingAction: vi.fn(), updateFindingStatusAction: vi.fn() }));
vi.mock("./share-actions", () => ({ mintAuditorTokenAction: vi.fn(), revokeAuditorTokenAction: vi.fn() }));
vi.mock("@/components/ai-suggestion-panel", () => ({ AiSuggestionPanel: () => null }));

import AuditDetailPage from "./page";

describe("AuditDetailPage member branch", () => {
  it("shows audit results and downloads without mutation or sharing controls", async () => {
    tables.length = 0;
    render(await AuditDetailPage({ params: Promise.resolve({ id: "audit-1" }) }));

    expect(screen.getByRole("heading", { name: "Access review" })).toBeInTheDocument();
    expect(screen.getByText("Audit status: Planned")).toBeInTheDocument();
    expect(screen.getByText("Finding status: Open")).toBeInTheDocument();
    expect(screen.getByText("Disable account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open corrective-action task" })).toHaveAttribute("href", "/app/tasks/task-1");
    expect(screen.getByRole("link", { name: "Evidence pack (XLSX)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Evidence pack (CSV)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Populate from control library" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raise finding" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Share with an auditor" })).not.toBeInTheDocument();
  });
});
