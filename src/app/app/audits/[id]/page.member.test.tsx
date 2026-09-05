import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => [] as string[]);
const role = vi.hoisted(() => ({ value: "member" }));
const queryError = vi.hoisted(() => ({ table: "" }));

function query(data: unknown[], table = "") {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "not"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: Error | null }) => unknown) => Promise.resolve({ data, error: queryError.table === table ? new Error("query failed") : null }).then(resolve);
  chain.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null });
  return chain;
}

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1" },
    membership: { role: role.value },
    supabase: { from: (table: string) => {
      tables.push(table);
      const rows: Record<string, unknown[]> = {
        audits: [{ id: "audit-1", reference: "AUD-001", title: "Access review", scope: "Access controls", status: "planned", framework: "ISO 27001", planned_start: null, planned_end: null }],
        audit_checklist_items: [{ id: "item-1", area: "Access", clause_reference: "A.5", checklist_item: "Review access", compliant: "compliant", evidence_note: "Evidence", findings: "" }],
        evidence: [{ id: "evidence-1", title: "Access review export", status: "current", collected_on: "2026-09-01", valid_until: "2027-09-01" }, { id: "evidence-2", title: "Long evidence title for mobile layout verification", status: "expiring", collected_on: "2026-09-02", valid_until: "2026-10-01" }],
        evidence_links: [{ id: "link-1", evidence_id: "evidence-1", audit_checklist_item_id: "item-1", evidence: { id: "evidence-1", title: "Access review export", status: "current", collected_on: "2026-09-01", valid_until: "2027-09-01" } }],
        audit_findings: [{ id: "finding-1", summary: "Expired account", severity: "minor_nc", status: "open", corrective_action: "Disable account", task_id: "task-1" }],
        memberships: [],
        auditor_access_tokens: [],
        ai_workspace_settings: [],
        auditor_access_log: [],
      };
      return query(rows[table] ?? [], table);
    } },
  }),
}));
vi.mock("../actions", () => ({ updateAuditStatusAction: vi.fn(), addChecklistItemAction: vi.fn(), populateAuditChecklistAction: vi.fn(), updateChecklistItemAction: vi.fn(), raiseFindingAction: vi.fn(), updateFindingStatusAction: vi.fn(), linkChecklistEvidenceAction: vi.fn() }));
vi.mock("./share-actions", () => ({ mintAuditorTokenAction: vi.fn(), revokeAuditorTokenAction: vi.fn() }));
vi.mock("@/components/ai-suggestion-panel", () => ({ AiSuggestionPanel: () => null }));

import AuditDetailPage from "./page";

describe("AuditDetailPage member branch", () => {
  it("shows audit results and downloads without mutation or sharing controls", async () => {
    role.value = "member";
    tables.length = 0;
    render(await AuditDetailPage({ params: Promise.resolve({ id: "audit-1" }) }));

    expect(screen.getByRole("heading", { name: "Access review" })).toBeInTheDocument();
    expect(screen.getByText("Audit status: Planned")).toBeInTheDocument();
    expect(screen.getByText("Finding status: Open")).toBeInTheDocument();
    expect(screen.getByText("Disable account")).toBeInTheDocument();
    expect(screen.getByText("Access review export")).toBeInTheDocument();
    expect(screen.getByText(/current/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open corrective-action task" })).toHaveAttribute("href", "/app/tasks/task-1");
    expect(screen.getByRole("link", { name: "Evidence pack (XLSX)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Evidence pack (CSV)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Populate from control library" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raise finding" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Share with an auditor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link evidence" })).not.toBeInTheDocument();
  });

  it("offers only unlinked evidence to operators with the audit and checklist ids", async () => {
    role.value = "owner";
    render(await AuditDetailPage({ params: Promise.resolve({ id: "audit-1" }) }));

    const select = screen.getByRole("combobox", { name: "Evidence to link to Review access" });
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "Long evidence title for mobile layout verification" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Access review export" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link evidence" })).toBeInTheDocument();
    const linkForm = screen.getByRole("button", { name: "Link evidence" }).closest("form")!;
    expect(within(linkForm).getByDisplayValue("audit-1")).toBeInTheDocument();
    expect(within(linkForm).getByDisplayValue("item-1")).toBeInTheDocument();
  });

  it("surfaces evidence query failures instead of rendering an empty evidence state", async () => {
    role.value = "member";
    queryError.table = "evidence";
    await expect(AuditDetailPage({ params: Promise.resolve({ id: "audit-1" }) })).rejects.toThrow("Could not load audit evidence");
    queryError.table = "";
  });
});
