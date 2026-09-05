import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  tables: [] as string[],
  organisationFilters: [] as Array<{ table: string; value: unknown }>,
  role: "member" as "member" | "admin",
  taskStatus: "open",
}));

function query(table: string, data: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "maybeSingle"]) chain[method] = vi.fn(() => chain);
  chain.eq = vi.fn((column: string, value: unknown) => {
    if (column === "organisation_id") hoisted.organisationFilters.push({ table, value });
    return chain;
  });
  chain.in = vi.fn((column: string, values: string[]) => {
    if (table === "tasks" && column === "status" && !values.includes(hoisted.taskStatus)) data = [];
    return chain;
  });
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1" },
    membership: { role: hoisted.role },
    supabase: {
      from: (table: string) => {
        hoisted.tables.push(table);
        return query(table, table === "evidence" ? [{
          id: "evidence-1", title: "Quarterly access review", kind: "note", url: null,
          storage_path: null, status: "current", collected_on: "2026-08-25", valid_until: "2026-09-24",
          description: "Fictional reviewer checked all sampled approvals and recorded a passing review.",
          source_id: null, evidence_sources: null, evidence_links: [{
            id: "link-policy-1", control_id: null, risk_id: null, task_id: null, policy_id: "policy-1",
            controls: null, risks: null, tasks: null, policies: { reference: "NS-POL-1", title: "Access policy" },
          }, { id: "link-audit-1", audit_checklist_item_id: "checklist-1", controls: null, risks: null, tasks: null, policies: null,
            audit_checklist_items: { audit_id: "audit-1", checklist_item: "Verify independent sign-off" } }],
        }] : table === "controls" ? [{ id: "control-1", code: "AC-1", title: "Access control" }] : table === "policies" ? [{ id: "policy-1", reference: "POL-1", title: "Access policy" }] : table === "risks" ? [{ id: "risk-1", reference: "R-1", title: "Access risk", status: "open" }] : table === "tasks" ? [{ id: "task-1", title: "Review access evidence", status: "open", source: "risk_treatment" }] : []);
      },
    },
  }),
}));
vi.mock("@/features/github/application/github-record-provenance", () => ({
  loadOfficialGitHubEvidenceProvenance: vi.fn().mockResolvedValue([]),
  parseOfficialRecordSelection: vi.fn().mockReturnValue(null),
}));

import EvidencePage from "./page";
afterEach(() => { cleanup(); hoisted.taskStatus = "open"; });

describe("EvidencePage Member branch", () => {
  it("shows the contents of immutable note evidence for review", async () => {
    hoisted.role = "member";
    render(await EvidencePage());
    expect(screen.getByText(/Fictional reviewer checked all sampled approvals/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quarterly access review" }).closest("section")).toHaveAttribute("id", "evidence-evidence-1");
    expect(screen.getByRole("link", { name: "Audit: Verify independent sign-off" })).toHaveAttribute("href", "/app/audits/audit-1");
    expect(screen.queryByText("Unspecified link")).not.toBeInTheDocument();
  });

  it("allows fresh verification evidence to be attached after a task is completed", async () => {
    hoisted.role = "admin";
    hoisted.taskStatus = "done";
    render(await EvidencePage());
    expect(screen.getByRole("option", { name: /Task: Review access evidence/ })).toHaveValue("task:task-1");
  });
  it("renders evidence read-only and hides all evidence mutations", async () => {
    hoisted.tables = [];
    hoisted.organisationFilters = [];
    hoisted.role = "member";

    render(await EvidencePage());

    expect(screen.getByRole("heading", { name: "Evidence vault" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quarterly access review" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add evidence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Supersede" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove link" })).not.toBeInTheDocument();
    expect(screen.getByText("Policy: NS-POL-1: Access policy")).toBeInTheDocument();
    expect(hoisted.tables).toContain("evidence");
  });

  it("offers active risk and treatment task targets to operators", async () => {
    hoisted.tables = [];
    hoisted.organisationFilters = [];
    hoisted.role = "admin";

    render(await EvidencePage());

    const select = screen.getByRole("combobox", { name: "Link Quarterly access review to a control" });
    expect(select).toHaveDisplayValue("Link to control…");
    expect(screen.getByRole("option", { name: "Risk R-1: Access risk" })).toHaveValue("risk:risk-1");
    expect(screen.getByRole("option", { name: "Task: Review access evidence" })).toHaveValue("task:task-1");
    expect(screen.getByRole("option", { name: "AC-1: Access control" })).toHaveValue("control:control-1");
    expect(screen.getByRole("option", { name: "POL-1: Access policy" })).toHaveValue("policy:policy-1");
    expect(hoisted.organisationFilters).toEqual(expect.arrayContaining([
      { table: "risks", value: "org-1" },
      { table: "tasks", value: "org-1" },
    ]));
  });

  it("renders policy links with their policy label instead of a missing task title", async () => {
    hoisted.tables = [];
    hoisted.organisationFilters = [];
    hoisted.role = "admin";

    render(await EvidencePage());

    expect(screen.getByText("Policy: NS-POL-1: Access policy")).toBeInTheDocument();
    expect(screen.queryByText("Task: undefined")).not.toBeInTheDocument();
  });
});
