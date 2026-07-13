import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const USER_ID = "30000000-0000-4000-8000-000000000003";

type MembershipRow = {
  organisation_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  job_title: string | null;
  created_at: string;
  organisations: { id: string; name: string };
};

const hoisted = vi.hoisted(() => ({
  activeOrganisationId: undefined as string | undefined,
  rows: [] as MembershipRow[],
  eqCalls: [] as Array<[string, unknown]>,
  orderCalls: [] as Array<[string, unknown]>,
  cookieSet: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({
    get: () => hoisted.activeOrganisationId === undefined ? undefined : { value: hoisted.activeOrganisationId },
    set: hoisted.cookieSet,
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID, email: "member@example.com" } } }) },
    from: (table: string) => {
      if (table !== "memberships") throw new Error(`Unexpected table ${table}`);
      let rows = [...hoisted.rows];
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          hoisted.eqCalls.push([column, value]);
          rows = rows.filter((row) => row[column as keyof MembershipRow] === value);
          return chain;
        },
        order: (column: string, options: unknown) => {
          hoisted.orderCalls.push([column, options]);
          rows.sort((left, right) => String(left[column as keyof MembershipRow]).localeCompare(String(right[column as keyof MembershipRow])));
          return chain;
        },
        limit: (count: number) => {
          rows = rows.slice(0, count);
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: { data: MembershipRow[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

import * as appContext from "./app-context";

function membership(organisationId: string, name: string, createdAt: string, userId = USER_ID): MembershipRow {
  return {
    organisation_id: organisationId,
    user_id: userId,
    role: "member",
    job_title: "Developer",
    created_at: createdAt,
    organisations: { id: organisationId, name },
  };
}

describe("active workspace membership resolution", () => {
  beforeEach(() => {
    hoisted.activeOrganisationId = undefined;
    hoisted.rows = [];
    hoisted.eqCalls = [];
    hoisted.orderCalls = [];
    hoisted.cookieSet.mockReset();
  });

  it("selects the cookie-nominated workspace after revalidating the user's membership", async () => {
    hoisted.activeOrganisationId = ORG_B;
    hoisted.rows = [
      membership(ORG_A, "Alpha", "2026-01-01T00:00:00.000Z"),
      membership(ORG_B, "Beta", "2026-02-01T00:00:00.000Z"),
    ];

    await expect(appContext.getMembership()).resolves.toMatchObject({ organisation_id: ORG_B });
    expect(hoisted.eqCalls).toContainEqual(["user_id", USER_ID]);
  });

  it.each([
    ["malformed", "not-a-uuid"],
    ["stale", "90000000-0000-4000-8000-000000000009"],
    ["foreign", "80000000-0000-4000-8000-000000000008"],
  ])("ignores a %s cookie and uses the deterministic fallback", async (_label, cookieValue) => {
    hoisted.activeOrganisationId = cookieValue;
    hoisted.rows = [
      membership(ORG_B, "Beta", "2026-02-01T00:00:00.000Z"),
      membership(ORG_A, "Alpha", "2026-01-01T00:00:00.000Z"),
      membership("80000000-0000-4000-8000-000000000008", "Foreign", "2025-01-01T00:00:00.000Z", "someone-else"),
    ];

    await expect(appContext.getMembership()).resolves.toMatchObject({ organisation_id: ORG_A });
    expect(hoisted.orderCalls).toEqual([
      ["created_at", { ascending: true }],
      ["organisation_id", { ascending: true }],
    ]);
  });

  it("uses organisation id as a deterministic tie-break for memberships created together", async () => {
    hoisted.rows = [
      membership(ORG_B, "Beta", "2026-01-01T00:00:00.000Z"),
      membership(ORG_A, "Alpha", "2026-01-01T00:00:00.000Z"),
    ];

    await expect(appContext.getMembership()).resolves.toMatchObject({ organisation_id: ORG_A });
  });

  it("writes a validated active-workspace id using a server-only, same-site cookie", async () => {
    const setActiveOrganisationCookie = (appContext as unknown as {
      setActiveOrganisationCookie: (organisationId: string) => Promise<void>;
    }).setActiveOrganisationCookie;

    await setActiveOrganisationCookie(ORG_B);

    expect(hoisted.cookieSet).toHaveBeenCalledWith(
      "compliancehub_active_organisation",
      ORG_B,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: expect.any(Number),
      }),
    );
  });

  it("refuses to write a malformed active-workspace id", async () => {
    const setActiveOrganisationCookie = (appContext as unknown as {
      setActiveOrganisationCookie: (organisationId: string) => Promise<void>;
    }).setActiveOrganisationCookie;

    await expect(setActiveOrganisationCookie("not-a-uuid")).rejects.toThrow("Invalid organisation id");
    expect(hoisted.cookieSet).not.toHaveBeenCalled();
  });
});
