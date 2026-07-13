import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  limitCalls: [] as number[],
  membershipQueryCount: 0,
  activeLookupError: null as unknown,
  fallbackError: null as unknown,
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
      hoisted.membershipQueryCount += 1;
      let rows = [...hoisted.rows];
      const queryEqCalls: Array<[string, unknown]> = [];
      const queryOrderCalls: Array<[string, { ascending?: boolean }]> = [];
      let limit: number | undefined;
      const materialise = () => {
        const result = [...rows].sort((left, right) => {
          for (const [column, options] of queryOrderCalls) {
            const comparison = String(left[column as keyof MembershipRow]).localeCompare(String(right[column as keyof MembershipRow]));
            if (comparison !== 0) return options.ascending === false ? -comparison : comparison;
          }
          return 0;
        });
        return limit === undefined ? result : result.slice(0, limit);
      };
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          hoisted.eqCalls.push([column, value]);
          queryEqCalls.push([column, value]);
          rows = rows.filter((row) => row[column as keyof MembershipRow] === value);
          return chain;
        },
        order: (column: string, options: { ascending?: boolean }) => {
          hoisted.orderCalls.push([column, options]);
          queryOrderCalls.push([column, options]);
          return chain;
        },
        limit: (count: number) => {
          hoisted.limitCalls.push(count);
          limit = count;
          return chain;
        },
        maybeSingle: () => {
          const isActiveLookup = queryEqCalls.some(([column]) => column === "organisation_id");
          const error = isActiveLookup ? hoisted.activeLookupError : hoisted.fallbackError;
          return Promise.resolve({ data: error ? null : materialise()[0] ?? null, error });
        },
        then: (resolve: (value: { data: MembershipRow[]; error: unknown }) => unknown) => {
          return Promise.resolve({ data: materialise(), error: hoisted.fallbackError }).then(resolve);
        },
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
    hoisted.limitCalls = [];
    hoisted.membershipQueryCount = 0;
    hoisted.activeLookupError = null;
    hoisted.fallbackError = null;
    hoisted.cookieSet.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects the cookie-nominated workspace after revalidating the user's membership", async () => {
    hoisted.activeOrganisationId = ORG_B;
    hoisted.rows = [
      membership(ORG_A, "Alpha", "2026-01-01T00:00:00.000Z"),
      membership(ORG_B, "Beta", "2026-02-01T00:00:00.000Z"),
    ];

    await expect(appContext.getMembership()).resolves.toMatchObject({ organisation_id: ORG_B });
    expect(hoisted.eqCalls).toEqual([
      ["user_id", USER_ID],
      ["organisation_id", ORG_B],
    ]);
    expect(hoisted.membershipQueryCount).toBe(1);
  });

  it.each([
    ["malformed", "not-a-uuid", 1],
    ["stale", "90000000-0000-4000-8000-000000000009", 2],
    ["foreign", "80000000-0000-4000-8000-000000000008", 2],
  ])("ignores a %s cookie and uses the deterministic fallback", async (_label, cookieValue, expectedQueryCount) => {
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
    expect(hoisted.limitCalls).toEqual([1]);
    expect(hoisted.membershipQueryCount).toBe(expectedQueryCount);
  });

  it("uses organisation id as a deterministic tie-break for memberships created together", async () => {
    hoisted.rows = [
      membership(ORG_B, "Beta", "2026-01-01T00:00:00.000Z"),
      membership(ORG_A, "Alpha", "2026-01-01T00:00:00.000Z"),
    ];

    await expect(appContext.getMembership()).resolves.toMatchObject({ organisation_id: ORG_A });
    expect(hoisted.limitCalls).toEqual([1]);
  });

  it("throws a safe error when the cookie-selected membership lookup fails", async () => {
    hoisted.activeOrganisationId = ORG_B;
    hoisted.activeLookupError = { message: "connection details that must not escape" };

    await expect(appContext.getMembership()).rejects.toThrow("Could not load active workspace");
    expect(hoisted.membershipQueryCount).toBe(1);
  });

  it("throws a safe error when the deterministic fallback lookup fails", async () => {
    hoisted.activeOrganisationId = "90000000-0000-4000-8000-000000000009";
    hoisted.fallbackError = { message: "connection details that must not escape" };

    await expect(appContext.getMembership()).rejects.toThrow("Could not load workspace membership");
    expect(hoisted.membershipQueryCount).toBe(2);
  });

  it("returns null only after a successful empty membership lookup", async () => {
    hoisted.rows = [];

    await expect(appContext.getMembership()).resolves.toBeNull();
    expect(hoisted.membershipQueryCount).toBe(1);
  });

  it.each([
    ["development", false],
    ["production", true],
  ])("writes a validated active-workspace id in %s with secure=%s", async (nodeEnv, secure) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
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
        secure,
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

  it("clears the active workspace using matching host-only cookie attributes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const clearActiveOrganisationCookie = (appContext as unknown as {
      clearActiveOrganisationCookie: () => Promise<void>;
    }).clearActiveOrganisationCookie;

    await clearActiveOrganisationCookie();

    expect(hoisted.cookieSet).toHaveBeenCalledWith(
      "compliancehub_active_organisation",
      "",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 0,
      }),
    );
  });
});
