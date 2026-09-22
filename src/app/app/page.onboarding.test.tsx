import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org-1", name: "Manual workspace" }, membership: { role: "owner" },
  supabase: { from: () => {
    let single = false;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "lt", "eq", "neq", "in", "not", "is", "order", "limit"]) query[method] = () => query;
    query.maybeSingle = () => { single = true; return query; };
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: single ? null : [], count: 0, error: null }).then(resolve);
    return query;
  } },
}) }));
vi.mock("./tasks/actions", () => ({ acceptCalendarSeedAction: vi.fn() }));
import AppHome from "./page";
it("keeps the original programme builder beside recent activity", async () => {
  render(await AppHome());
  expect(screen.getByRole("heading", { name: "Build your programme" })).toBeInTheDocument();
  expect(screen.getByText("1 of 7 done")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /setup roadmap|continue your programme/i })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "What changed" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Reduce admin later" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open risks/ })).toHaveAttribute("href", "/app/risks");
});
