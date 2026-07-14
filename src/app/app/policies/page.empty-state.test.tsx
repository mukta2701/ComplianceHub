import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  role: "member" as "owner" | "admin" | "member",
  scopedTables: [] as string[],
}));

function query(table: string) {
  const result = { data: [], count: table === "memberships" ? 2 : null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order"]) chain[method] = vi.fn(() => chain);
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
  afterEach(cleanup);

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
});
