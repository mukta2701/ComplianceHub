import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  role: "member" as "owner" | "admin" | "member",
  scopedTables: [] as string[],
  rows: {} as Record<string, unknown[]>,
}));

function query(table: string) {
  const result = { data: hoisted.rows[table] ?? [], count: table === "memberships" ? 2 : null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order"]) chain[method] = vi.fn(() => chain);
  chain.range = vi.fn((from: number, to: number) => Promise.resolve({ ...result, data: result.data.slice(from, to + 1) }));
  chain.eq = vi.fn((column: string, value: unknown) => {
    if (column === "organisation_id" && value === "org-1") hoisted.scopedTables.push(table);
    return chain;
  });
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: (table: string) => query(table) },
    user: { id: "user-1" },
    membership: { role: hoisted.role },
    organisation: { id: "org-1", name: "Example Ltd" },
  }),
}));

import PoliciesPage from "./page";

describe("policy library empty state", () => {
  afterEach(() => { cleanup(); hoisted.rows = {}; });

  it("gives Members a read-only empty state", async () => {
    hoisted.role = "member";
    hoisted.scopedTables = [];
    render(await PoliciesPage());

    expect(screen.getByText("No approved policies are available yet.")).toBeInTheDocument();
    expect(screen.queryByText(/author your first policy/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New policy" })).not.toBeInTheDocument();
    expect(hoisted.scopedTables.sort()).toEqual(["policies", "policy_acceptances"].sort());
  });

  it("keeps the actionable empty state for operators", async () => {
    hoisted.role = "admin";
    hoisted.scopedTables = [];
    render(await PoliciesPage());

    expect(screen.getByText("No policies yet. Author your first policy to start tracking acceptance.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New policy" })).toHaveAttribute("href", "/app/policies/new");
    expect(hoisted.scopedTables.sort()).toEqual(["memberships", "policies", "policy_acceptances"].sort());
  });
  it("includes acceptance and members beyond the first thousand in a policy's reported total", async () => {
    hoisted.role = "owner";
    hoisted.rows = {
      policies: [{ id: "policy-1", reference: "POL-1", title: "Large workspace policy", status: "approved", version: 2, owner_id: null, review_due: null }],
      memberships: Array.from({ length: 1001 }, (_, i) => ({ user_id: `member-${i}`, profiles: { display_name: `Member ${i}` } })),
      policy_acceptances: Array.from({ length: 1001 }, (_, i) => ({ policy_id: "policy-1", user_id: `member-${i}`, accepted_version: 2 })),
    };
    render(await PoliciesPage());
    expect(screen.getAllByText("1001/1001 (100%)")).toHaveLength(2);
  });

});
