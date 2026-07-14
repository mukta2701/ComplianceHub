import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ organisationEq: vi.fn() }));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1", name: "Example Ltd" },
    supabase: {
      from: () => {
        const result = { data: [], error: null };
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn((column: string, value: unknown) => {
          hoisted.organisationEq(column, value);
          return chain;
        });
        for (const method of ["order", "limit"]) chain[method] = vi.fn(() => chain);
        chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
        return chain;
      },
    },
  }),
}));

import NotificationsPage from "./page";

describe("notifications active workspace scope", () => {
  it("loads only notifications from the active organisation", async () => {
    render(await NotificationsPage());

    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(hoisted.organisationEq).toHaveBeenCalledWith("organisation_id", "org-1");
  });
});
