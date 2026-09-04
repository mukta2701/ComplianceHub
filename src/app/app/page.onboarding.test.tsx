import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org-1", name: "Manual workspace" }, membership: { role: "owner" },
  supabase: { from: () => {
    let single = false;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "not", "is", "order", "limit"]) query[method] = () => query;
    query.maybeSingle = () => { single = true; return query; };
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: single ? null : [], count: 0, error: null }).then(resolve);
    return query;
  } },
}) }));
vi.mock("./tasks/actions", () => ({ acceptCalendarSeedAction: vi.fn() }));
import AppHome from "./page";
it("keeps integrations optional outside the seven core onboarding steps", async () => {
  const { container } = render(await AppHome());
  const checklist = within(container.querySelector(".onboarding-card") as HTMLElement);
  expect(checklist.getByText("1 of 7 done")).toBeInTheDocument();
  expect(checklist.queryByText("Connect a tracker")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Reduce admin later" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Explore integrations/ })).toHaveAttribute("href", "/app/setup");
});
