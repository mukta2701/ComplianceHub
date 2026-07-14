import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONTROL_1 = "40000000-0000-4000-8000-000000000001";
const CONTROL_2 = "40000000-0000-4000-8000-000000000002";
const CONTROL_3 = "40000000-0000-4000-8000-000000000003";

const hoisted = vi.hoisted(() => ({
  role: "member" as "owner" | "admin" | "member",
  rows: {} as Record<string, unknown[]>,
}));

function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: hoisted.rows[table] ?? [], error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: (table: string) => query(table) },
    organisation: { id: "org-1", name: "Example Ltd" },
    membership: { role: hoisted.role },
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/frameworks" }));

import FrameworksPage from "./page";

function populatedRows() {
  return {
    controls: [
      { id: CONTROL_1, code: "A.5.1", title: "Policies for information security" },
      { id: CONTROL_2, code: "A.5.15", title: "Access control" },
      { id: CONTROL_3, code: "A.8.9", title: "Configuration management" },
    ],
    control_crosswalks: [
      { id: "50000000-0000-4000-8000-000000000001", control_id: CONTROL_1, framework: "gdpr", external_ref: "Art.32", note: null, created_at: "2026-07-14T00:00:00Z" },
      { id: "50000000-0000-4000-8000-000000000002", control_id: CONTROL_2, framework: "gdpr", external_ref: "Art.32", note: "Access reviews support this reference.", created_at: "2026-07-14T00:01:00Z" },
      { id: "50000000-0000-4000-8000-000000000003", control_id: CONTROL_3, framework: "soc_2", external_ref: "CC6.1", note: "Configuration evidence is still being established.", created_at: "2026-07-14T00:02:00Z" },
    ],
    soa_items: [
      { control_id: "60000000-0000-4000-8000-000000000001", status: "planned" },
      { control_id: "60000000-0000-4000-8000-000000000002", status: "operational" },
      { control_id: "60000000-0000-4000-8000-000000000003", status: "developing" },
    ],
    requirement_control_mappings: [
      { requirement_id: "60000000-0000-4000-8000-000000000001", control_id: CONTROL_1 },
      { requirement_id: "60000000-0000-4000-8000-000000000002", control_id: CONTROL_2 },
      { requirement_id: "60000000-0000-4000-8000-000000000003", control_id: CONTROL_3 },
    ],
  };
}

describe("Framework coverage page", () => {
  beforeEach(() => {
    hoisted.role = "member";
    hoisted.rows = populatedRows();
  });

  it("gives Members an honest, accessible read-only explanation and mapping table", async () => {
    render(await FrameworksPage());

    expect(screen.getByRole("heading", { name: "Framework coverage from your Statement of Applicability" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "How recorded coverage works" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/measure only the requirements your organisation has recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/not total framework compliance, certification, legal advice, or audit assurance/i)).toBeInTheDocument();
    expect(screen.getByText("All 1 recorded requirement covered")).toBeInTheDocument();
    expect(screen.queryByText(/fully compliant|100% compliant/i)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "GDPR recorded mapping coverage" })).toHaveAttribute("aria-valuenow", "100");

    const table = screen.getByRole("table", { name: "Recorded framework mappings" });
    for (const heading of ["Source ISO control", "Target framework", "Published requirement", "Rationale / interpretation", "Recorded coverage"]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    expect(within(table).getAllByText("Covered")).toHaveLength(2);
    expect(within(table).getByText("Not yet covered")).toBeInTheDocument();
    expect(within(table).getByText("No rationale recorded (legacy mapping)")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add a mapping" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove mapping/ })).not.toBeInTheDocument();
  });

  it("shows the guided, required mapping controls to an Admin", async () => {
    hoisted.role = "admin";
    render(await FrameworksPage());

    const form = screen.getByRole("form", { name: "Add a framework mapping" });
    expect(within(form).getByLabelText("Source ISO control")).toBeRequired();
    expect(within(form).getByLabelText("Target framework")).toBeRequired();
    expect(within(form).getByLabelText("Published requirement reference")).toBeRequired();
    expect(within(form).getByLabelText("Required rationale / interpretation")).toBeRequired();
    expect(screen.getAllByRole("button", { name: /Remove mapping/ })).toHaveLength(3);
  });

  it("describes an empty framework as having no recorded mappings, not zero compliance", async () => {
    hoisted.rows = { ...populatedRows(), control_crosswalks: [] };
    render(await FrameworksPage());

    expect(screen.getAllByText("No recorded mappings yet")).toHaveLength(5);
    expect(screen.getByText(/No mappings have been recorded for this workspace/i)).toBeInTheDocument();
    expect(screen.queryByText(/0% compliant|0% coverage/i)).not.toBeInTheDocument();
  });
});
