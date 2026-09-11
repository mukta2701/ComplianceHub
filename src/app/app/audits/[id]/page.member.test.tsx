import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => [] as string[]);
const role = vi.hoisted(() => ({ value: "member" }));
const queryError = vi.hoisted(() => ({ table: "" }));
const largeEvidence = vi.hoisted(() => ({ value: false }));

function query(data: unknown[], table = "") {
  const chain: Record<string, unknown> = {};
  let rangeStart = 0;
  let rangeEnd = Number.POSITIVE_INFINITY;
  for (const method of ["select", "eq", "order", "not", "in", "or", "ilike"]) chain[method] = vi.fn(() => chain);
  chain.gt = vi.fn(() => chain);
  chain.limit = vi.fn((value:number) => { rangeEnd = value - 1; return chain; });
  chain.range = vi.fn((from:number,to:number) => { rangeStart = from; rangeEnd = to; return chain; });
  chain.then = (resolve: (value: { data: unknown[]; error: Error | null }) => unknown) => {
    const page = data.slice(rangeStart,Number.isFinite(rangeEnd) ? rangeEnd + 1 : undefined);
    return Promise.resolve({ data:page, count:data.length, error: queryError.table === table ? new Error("query failed") : null }).then(resolve);
  };
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
        evidence: largeEvidence.value ? Array.from({ length:501 }, (_,index) => ({ id:`evidence-${String(index + 1).padStart(4,"0")}`,title:`Evidence choice ${index + 1}`,kind:"note",source_id:null,evidence_sources:null,status:"current",collected_on:"2026-09-01",valid_until:"2027-09-01" })) : [{ id: "evidence-1", title: "Access review export", kind:"link", source_id:null, evidence_sources:null, status: "current", collected_on: "2026-09-01", valid_until: "2027-09-01" }, { id: "evidence-2", title: "Long evidence title for mobile layout verification", kind:"note", source_id:null, evidence_sources:null, status: "expiring", collected_on: "2026-09-02", valid_until: "2026-10-01" }],
        evidence_links: [{ id: "link-1", evidence_id: "evidence-1", audit_checklist_item_id: "item-1", evidence: { id: "evidence-1", title: "Access review export", kind:"link", source_id:null, evidence_sources:null, status: "current", collected_on: "2026-09-01", valid_until: "2027-09-01" } }],
        audit_findings: [{ id: "finding-1", summary: "Expired account", severity: "minor_nc", status: "open", corrective_action: "Disable account", task_id: "task-1", checklist_item_id:"item-1" }],
        memberships: [],
        auditor_access_tokens: [{ id:"token-org",label:"Board reviewer",expires_at:"2027-01-31T00:00:00Z",revoked_at:null,audit_id:null }],
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
    expect(screen.getByText("Audit status").closest("p")).toHaveTextContent("Audit status Planned");
    expect(screen.getByText("Finding status: Open")).toBeInTheDocument();
    expect(screen.getByText("Disable account")).toBeInTheDocument();
    expect(screen.getByText("Checklist: Review access")).toBeInTheDocument();
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

    const select = screen.getByRole("combobox", { name: "Evidence record" });
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "Long evidence title for mobile layout verification" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Access review export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link evidence" })).toBeInTheDocument();
    expect(screen.getByText(/Board reviewer · Whole readiness view/)).toBeInTheDocument();
    const linkForm = screen.getByRole("button", { name: "Link evidence" }).closest("form")!;
    expect(within(linkForm).getByDisplayValue("audit-1")).toBeInTheDocument();
    expect(within(linkForm).getByRole("combobox", { name:"Checklist item" })).toHaveValue("");
    expect(within(linkForm).getByRole("option", { name:"A.5 — Review access" })).toBeInTheDocument();
  });

  it("offers evidence beyond the first database page without rendering every record", async () => {
    role.value = "owner";
    largeEvidence.value = true;
    render(await AuditDetailPage({ params: Promise.resolve({ id: "audit-1" }),searchParams:Promise.resolve({ proofPage:"21" }) }));

    expect(screen.getByRole("option", { name:"Evidence choice 501" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name:"Evidence choice 1" })).not.toBeInTheDocument();
    expect(screen.getByText("Page 21 of 21")).toBeInTheDocument();
    largeEvidence.value = false;
  });

  it("uses the last real evidence page when a saved URL points beyond the results", async () => {
    role.value = "owner";
    largeEvidence.value = true;
    render(await AuditDetailPage({ params: Promise.resolve({ id: "audit-1" }),searchParams:Promise.resolve({ proofPage:"99" }) }));

    expect(screen.getByRole("option", { name:"Evidence choice 501" })).toBeInTheDocument();
    expect(screen.queryByText("No evidence matches this search.")).not.toBeInTheDocument();
    expect(screen.getByText("Page 21 of 21")).toBeInTheDocument();
    expect(screen.getByRole("link", { name:"Previous" })).toHaveAttribute("href", "?proofQuery=&proofPage=20#link-audit-proof");
    largeEvidence.value = false;
  });

  it("surfaces evidence query failures instead of rendering an empty evidence state", async () => {
    role.value = "member";
    queryError.table = "evidence_links";
    await expect(AuditDetailPage({ params: Promise.resolve({ id: "audit-1" }) })).rejects.toThrow("Could not load audit evidence");
    queryError.table = "";
  });
});
