import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  monitoring: [] as Record<string, unknown>[], audit: [] as Record<string, unknown>[],
  role: "owner", error: null as null | { message: string },
  filters: [] as Array<[string, string, unknown]>,
}));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org-1" }, user: { id: "user-1" }, membership: { role: state.role },
  supabase: { from(table: string) {
    const data = table === "tasks" ? { id: "task-1", title: "Review access", status: "done", source: "monitoring", detail: null, due_on: "2026-12-31", assignment_revision: 0, owner_id: null, control_id: null, risk_id: null }
      : table === "monitoring_findings" ? state.monitoring : table === "audit_findings" ? state.audit
      : table === "evidence_links" || table === "integration_connections" ? [] : null;
    const q = {
      select: () => q, eq: (column: string, value: unknown) => { state.filters.push([table, column, value]); return q; },
      order: () => q, is: () => q, maybeSingle: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: table === "monitoring_findings" ? state.error : null }).then(resolve),
    };
    return q;
  } },
}) }));
vi.mock("../actions", () => ({ updateTaskStatusAction: vi.fn() }));
vi.mock("./tracker-actions", () => ({ pushTaskToTrackerAction: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
import TaskDetailPage from "./page";

beforeEach(() => { state.monitoring = []; state.audit = []; state.role = "owner"; state.error = null; state.filters = []; });
afterEach(cleanup);
const page = () => TaskDetailPage({ params: Promise.resolve({ id: "task-1" }) });

describe("task finding lineage", () => {
  it("keeps an unresolved monitoring finding visible when its task is done", async () => {
    state.monitoring = [{ id: "finding-1", title: "Review required", status: "in_progress", finding_origin: "github", resolved_at: null }];
    render(await page());
    expect(screen.getByRole("link", { name: "Review required" })).toHaveAttribute("href", "/app/monitoring?finding=finding-1");
    expect(screen.getByText(/finding status: in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/newer fresh passing check/i)).toBeInTheDocument();
    expect(screen.getByText(/completing this task does not resolve/i)).toBeInTheDocument();
    expect(state.filters).toContainEqual(["monitoring_findings", "organisation_id", "org-1"]);
    expect(state.filters).toContainEqual(["monitoring_findings", "task_id", "task-1"]);
  });
  it("shows an independently closed audit finding and returns Members to its audit", async () => {
    state.role = "member";
    state.audit = [{ id: "audit-finding-1", audit_id: "audit-1", summary: "Access approval missing", status: "closed" }];
    render(await page());
    expect(screen.getByRole("link", { name: "Access approval missing" })).toHaveAttribute("href", "/app/audits/audit-1");
    expect(screen.getByText(/finding status: closed/i)).toBeInTheDocument();
    expect(screen.getByText(/review the audit checklist and supporting evidence/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(state.filters).toContainEqual(["audit_findings", "organisation_id", "org-1"]);
  });
  it("does not silently hide findings if the relationship query fails", async () => {
    state.error = { message: "private database detail" };
    await expect(page()).rejects.toThrow("Could not load the task's linked findings");
  });
  it("does not promise a resolved finding will appear in the active monitoring list", async () => {
    state.monitoring = [{ id: "finding-1", title: "Review required", status: "resolved", finding_origin: "github", resolved_at: "2026-09-05T12:00:00Z" }];
    render(await page());
    expect(screen.getByText(/finding status: resolved/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review required" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open monitoring" })).toHaveAttribute("href", "/app/monitoring");
  });
});
