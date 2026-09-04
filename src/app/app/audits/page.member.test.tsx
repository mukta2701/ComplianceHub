import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/audits" }));

function query(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle", "in", "lt"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1" },
    membership: { role: "member" },
    supabase: { from: (table: string) => query(table === "audits" ? [{ id: "audit-1", reference: "AUD-001", title: "Access review", status: "planned", planned_start: null, planned_end: null }] : []) },
  }),
}));

import AuditsPage from "./page";

describe("AuditsPage member branch", () => {
  it("shows audit progress without audit planning controls", async () => {
    render(await AuditsPage());

    expect(screen.getByRole("heading", { name: "Internal audits" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Access review" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan an audit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan your first audit" })).not.toBeInTheDocument();
  });
});
