import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const result = vi.hoisted(() => ({ failures: new Set<string>(), missingRegister: false }));
function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle", "in", "lt"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
    result.failures.has(table) ? { data: null, error: new Error(`${table} unavailable`) } : table === "soa_registers" ? { data: result.missingRegister ? null : { id: "soa-1" }, error: null } : table === "audits" ? { data: [{ id: "a1", reference: "AUD-001", title: "Access review", status: "planned", planned_start: null, planned_end: null }], error: null } : table === "soa_items" ? { data: [{ applicable: true, status: "pending", owner_id: null }, { applicable: true, status: "complete", owner_id: null }, { applicable: false, status: "pending", owner_id: null }], error: null } : table === "evidence" ? { data: [], count: 1, error: null } : table === "tasks" ? { data: [], count: 1, error: null } : table === "audit_findings" ? { data: [{ severity: "major", status: "open" }], error: null } : { data: table === "organisation_scope_profiles" ? { scope_statement: "Scope", services: "Services", locations: "Locations", information_types: "Information", dependencies: "Dependencies", exclusions: "None" } : [], count: 0, error: null },
  ).then(resolve);
  return chain;
}
vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve({ organisation: { id: "org-1" }, membership: { role: "member" }, supabase: { from: (table: string) => query(table) } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/audits" }));
import AuditsPage from "./page";

describe("AuditsPage restored preflight", () => {
  it("renders deterministic blockers and keeps planning unavailable to Members", async () => {
    result.failures.clear();
    render(await AuditsPage());
    expect(screen.getByRole("heading", { name: "Audit preflight" })).toBeInTheDocument();
    expect(screen.getByText(/1 applicable SoA control still need review/i)).toBeInTheDocument();
    expect(screen.getByText(/2 applicable SoA controls have no owner/i)).toBeInTheDocument();
    expect(screen.getByText(/1 evidence record is expired/i)).toBeInTheDocument();
    expect(screen.getByText(/1 remediation task is overdue/i)).toBeInTheDocument();
    expect(screen.getByText(/1 audit finding remains open/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan an audit" })).not.toBeInTheDocument();
  });

  it("does not claim a clean preflight when a required query fails", async () => {
    result.failures = new Set(["tasks"]);
    render(await AuditsPage());
    expect(screen.getByRole("alert")).toHaveTextContent(/data is unavailable/i);
    expect(screen.queryByText(/No deterministic blockers found/i)).not.toBeInTheDocument();
  });

  it("treats a missing SoA as an actionable readiness blocker", async () => {
    result.failures.clear();
    result.missingRegister = true;
    render(await AuditsPage());
    expect(screen.getByText(/Create a Statement of Applicability to assess control readiness/i)).toBeInTheDocument();
    expect(screen.queryByText(/No deterministic blockers found/i)).not.toBeInTheDocument();
  });

  it("does not show an empty audit register when audit loading fails", async () => {
    result.missingRegister = false;
    result.failures = new Set(["audits"]);
    render(await AuditsPage());
    expect(screen.getByRole("alert")).toHaveTextContent(/audit records are unavailable/i);
    expect(screen.queryByText(/Plan your first audit/i)).not.toBeInTheDocument();
  });
});
