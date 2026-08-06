import { describe, expect, it, vi } from "vitest";
import { McpError } from "../auth/errors";
import { listWorkspaces, resolveWorkspace, WorkspaceRequiredError } from "./workspace-access";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const ORG_A = "20000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";

function membershipClient(rows: unknown[], error: unknown = null) {
  let range: [number, number] | null = null;
  const filters: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((column: string, value: unknown) => { filters.push([column, value]); return chain; });
  chain.order = vi.fn(() => chain);
  chain.range = vi.fn((from: number, to: number) => { range = [from, to]; return chain; });
  const result = (single = false) => {
    const org = filters.find(([column]) => column === "organisation_id")?.[1];
    const filtered = org ? rows.filter((row) => (row as { organisation_id?: unknown }).organisation_id === org) : rows;
    const selected = range ? filtered.slice(range[0], range[1] + 1) : filtered;
    return { data: single ? selected[0] ?? null : selected, error };
  };
  chain.maybeSingle = vi.fn(async () => result(true));
  chain.then = (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve);
  return { client: { from: vi.fn(() => chain) }, chain, filters };
}

const rows = [
  { organisation_id: ORG_A, role: "owner", organisation: { id: ORG_A, name: "Alpha" } },
  { organisation_id: ORG_B, role: "member", organisation: { id: ORG_B, name: "Beta" } },
];

describe("MCP workspace access", () => {
  it("filters memberships by the verified user and returns only safe fields", async () => {
    const { client, chain } = membershipClient(rows);
    await expect(listWorkspaces(client as never, USER_ID)).resolves.toEqual([
      { id: ORG_A, name: "Alpha", role: "owner" },
      { id: ORG_B, name: "Beta", role: "member" },
    ]);
    expect(chain.select).toHaveBeenCalledWith("organisation_id,role,organisation:organisations!inner(id,name)");
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("auto-selects one workspace but requires a choice when several are accessible", async () => {
    const one = membershipClient(rows.slice(0, 1));
    await expect(resolveWorkspace(one.client as never, USER_ID)).resolves.toMatchObject({ id: ORG_A });

    const many = membershipClient(rows);
    const error = await resolveWorkspace(many.client as never, USER_ID).catch((caught) => caught);
    expect(error).toBeInstanceOf(WorkspaceRequiredError);
    expect(error.toStructuredContent().error.choices).toEqual([
      { id: ORG_A, name: "Alpha" }, { id: ORG_B, name: "Beta" },
    ]);
  });

  it("distinguishes invalid, inaccessible, and absent workspace states safely", async () => {
    await expect(resolveWorkspace(membershipClient(rows).client as never, USER_ID, "bad"))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" } satisfies Partial<McpError>);
    await expect(resolveWorkspace(membershipClient(rows.slice(0, 1)).client as never, USER_ID, ORG_B))
      .rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<McpError>);
    await expect(resolveWorkspace(membershipClient([]).client as never, USER_ID))
      .rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<McpError>);
  });

  it("paginates the full workspace list and directly scopes supplied IDs by user and organisation", async () => {
    const manyRows = Array.from({ length: 1_205 }, (_, index) => {
      const id = `26000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      return { organisation_id: id, role: "member", organisation: { id, name: `Workspace ${index}` } };
    });
    const paged = membershipClient(manyRows);
    await expect(listWorkspaces(paged.client as never, USER_ID)).resolves.toHaveLength(1_205);
    expect(paged.chain.range).toHaveBeenCalledTimes(4);

    const direct = membershipClient(manyRows);
    const target = manyRows[1_204]!.organisation_id;
    await expect(resolveWorkspace(direct.client as never, USER_ID, target)).resolves.toMatchObject({ id: target });
    expect(direct.filters).toContainEqual(["user_id", USER_ID]);
    expect(direct.filters).toContainEqual(["organisation_id", target]);
    expect(direct.chain.range).not.toHaveBeenCalled();
  });

  it("fails closed when the membership query fails", async () => {
    await expect(listWorkspaces(membershipClient([], { message: "db secret" }).client as never, USER_ID))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" } satisfies Partial<McpError>);
  });
});
