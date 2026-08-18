import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANISATION_ID = "22222222-2222-4222-8222-222222222222";

const hoisted = vi.hoisted(() => ({
  requireContext: vi.fn(),
  queries: [] as Array<{ table: string; column: string; value: unknown }>,
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("../actions", () => ({ createSoaAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/soa" }));

function activeContext() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    assessment_sessions: [{ id: "assessment-sibling", organisation_id: OTHER_ORGANISATION_ID, title: "Sibling assessment", updated_at: "2026-08-18T00:00:00Z" }],
    soa_registers: [{ id: "register-sibling", organisation_id: OTHER_ORGANISATION_ID, title: "Sibling draft", version: 2, updated_at: "2026-08-18T00:00:00Z" }],
    soa_snapshots: [{ id: "snapshot-sibling", organisation_id: OTHER_ORGANISATION_ID, title: "Sibling snapshot", version: 1, finalised_at: "2026-08-18T00:00:00Z" }],
  };
  const supabase = {
    from(table: string) {
      const equals: Array<[string, unknown]> = [];
      // The minimal fake deliberately leaves Supabase's fluent builder dynamic.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: Record<string, (...args: any[]) => any> = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => {
          equals.push([column, value]);
          hoisted.queries.push({ table, column, value });
          return builder;
        }),
        order: vi.fn(() => builder),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const data = (rows[table] ?? []).filter((row) => equals.every(([column, value]) => row[column] === value));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { supabase, organisation: { id: ORGANISATION_ID, name: "Active organisation" }, user: { id: "user-1" }, membership: { role: "owner" } };
}

beforeEach(() => {
  hoisted.queries.length = 0;
  hoisted.requireContext.mockResolvedValue(activeContext());
});

describe("SoA index active organisation scope", () => {
  it("does not list sibling assessments, drafts, or snapshots", async () => {
    const { default: SoaPage } = await import("./page");

    render(await SoaPage());

    expect(screen.queryByText("Sibling assessment")).not.toBeInTheDocument();
    expect(screen.queryByText("Sibling draft")).not.toBeInTheDocument();
    expect(screen.queryByText("Sibling snapshot")).not.toBeInTheDocument();
    expect(hoisted.queries).toEqual(expect.arrayContaining([
      { table: "assessment_sessions", column: "organisation_id", value: ORGANISATION_ID },
      { table: "soa_registers", column: "organisation_id", value: ORGANISATION_ID },
      { table: "soa_snapshots", column: "organisation_id", value: ORGANISATION_ID },
    ]));
  });
});
