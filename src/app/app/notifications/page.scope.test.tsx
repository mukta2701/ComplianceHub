import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ organisationEq: vi.fn(), selectColumns: vi.fn() }));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1", name: "Example Ltd" },
    supabase: {
      from: () => {
        const result = { data: [{
          id: 7,
          kind: "github_compliance_failure",
          message: "A GitHub compliance check failed.",
          subject_type: "github_official_compliance_result",
          subject_id: "10000000-0000-4000-8000-000000000003",
          read_at: null,
          created_at: "2026-09-24T10:01:00.000Z",
        }], error: null };
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn((columns: string) => {
          hoisted.selectColumns(columns);
          return chain;
        });
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
    expect(hoisted.selectColumns).toHaveBeenCalledWith("id,kind,message,subject_type,subject_id,read_at,created_at");
    expect(screen.getByRole("link", { name: "Open GitHub result" })).toHaveAttribute(
      "href",
      "/app/monitoring/github-results/10000000-0000-4000-8000-000000000003",
    );
  });

});
