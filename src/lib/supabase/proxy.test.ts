import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORG_A = "61000000-0000-4000-8000-000000000001";
const ORG_B = "61000000-0000-4000-8000-000000000002";
const USER_ID = "62000000-0000-4000-8000-000000000001";

type Membership = {
  organisation_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  created_at: string;
};

const hoisted = vi.hoisted(() => ({
  user: null as null | { id: string },
  rows: [] as Membership[],
  queryError: null as null | { message: string },
  eqCalls: [] as Array<[string, unknown]>,
  refreshedCookies: [] as Array<{
    name: string;
    value: string;
    options: { httpOnly?: boolean; path?: string; sameSite?: "lax" };
  }>,
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicEnvironment: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookies: { setAll: (cookies: typeof hoisted.refreshedCookies) => void };
  }) => ({
    auth: {
      getUser: () => {
        if (hoisted.refreshedCookies.length > 0) options.cookies.setAll(hoisted.refreshedCookies);
        return Promise.resolve({ data: { user: hoisted.user }, error: null });
      },
    },
    from: (table: string) => {
      if (table !== "memberships") throw new Error(`Unexpected table: ${table}`);
      let rows = [...hoisted.rows];
      const orders: Array<[keyof Membership, boolean]> = [];
      let limit: number | null = null;
      const materialise = () => {
        const ordered = [...rows].sort((left, right) => {
          for (const [column, ascending] of orders) {
            const compared = String(left[column]).localeCompare(String(right[column]));
            if (compared !== 0) return ascending ? compared : -compared;
          }
          return 0;
        });
        return limit === null ? ordered : ordered.slice(0, limit);
      };
      const query = {
        select: () => query,
        eq: (column: keyof Membership, value: unknown) => {
          hoisted.eqCalls.push([column, value]);
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        order: (column: keyof Membership, options: { ascending?: boolean }) => {
          orders.push([column, options.ascending !== false]);
          return query;
        },
        limit: (count: number) => {
          limit = count;
          return query;
        },
        maybeSingle: () => Promise.resolve({
          data: hoisted.queryError ? null : materialise()[0] ?? null,
          error: hoisted.queryError,
        }),
      };
      return query;
    },
  }),
}));

import { refreshSupabaseSession } from "./proxy";

function request(pathname: string, activeOrganisationId?: string): NextRequest {
  const headers = new Headers();
  if (activeOrganisationId) {
    headers.set("cookie", `compliancehub_active_organisation=${activeOrganisationId}`);
  }
  return new NextRequest(`https://compliancehub.example${pathname}`, { headers });
}

function membership(organisationId: string, role: Membership["role"], createdAt: string): Membership {
  return { organisation_id: organisationId, user_id: USER_ID, role, created_at: createdAt };
}

describe("workspace request session and capability guard", () => {
  beforeEach(() => {
    hoisted.user = { id: USER_ID };
    hoisted.rows = [];
    hoisted.queryError = null;
    hoisted.eqCalls = [];
    hoisted.refreshedCookies = [];
  });

  it("redirects unauthenticated pages and returns 401 for APIs", async () => {
    hoisted.user = null;

    const pageResponse = await refreshSupabaseSession(request("/app/policies"));
    const apiResponse = await refreshSupabaseSession(request("/api/app/tasks/export"));

    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toBe("https://compliancehub.example/sign-in");
    expect(apiResponse.status).toBe(401);
    await expect(apiResponse.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("allows onboarding only while an authenticated user has no membership", async () => {
    const onboarding = await refreshSupabaseSession(request("/app/onboarding"));
    const app = await refreshSupabaseSession(request("/app"));
    const api = await refreshSupabaseSession(request("/api/app/reports/readiness/pdf"));

    expect(onboarding.headers.get("x-middleware-next")).toBe("1");
    expect(app.headers.get("location")).toBe("https://compliancehub.example/app/onboarding");
    expect(api.status).toBe(403);
  });

  it("uses the validated active workspace role when a user has multiple memberships", async () => {
    hoisted.rows = [
      membership(ORG_A, "member", "2026-01-01T00:00:00.000Z"),
      membership(ORG_B, "admin", "2026-02-01T00:00:00.000Z"),
    ];

    const memberFallback = await refreshSupabaseSession(request("/app/settings"));
    const activeAdmin = await refreshSupabaseSession(request("/app/settings", ORG_B));

    expect(memberFallback.headers.get("location")).toBe("https://compliancehub.example/app");
    expect(activeAdmin.headers.get("x-middleware-next")).toBe("1");
    expect(hoisted.eqCalls).toContainEqual(["organisation_id", ORG_B]);
  });

  it.each(["not-a-uuid", "61000000-0000-4000-8000-000000000099"])(
    "falls back deterministically when the active workspace cookie is %s",
    async (cookieValue) => {
      hoisted.rows = [
        membership(ORG_B, "admin", "2026-02-01T00:00:00.000Z"),
        membership(ORG_A, "member", "2026-01-01T00:00:00.000Z"),
      ];

      const response = await refreshSupabaseSession(request("/app/settings", cookieValue));

      expect(response.headers.get("location")).toBe("https://compliancehub.example/app");
    },
  );

  it("redirects Member work areas, forbids operational APIs, and allows the report PDF", async () => {
    hoisted.rows = [membership(ORG_A, "member", "2026-01-01T00:00:00.000Z")];

    const settings = await refreshSupabaseSession(request("/app/settings"));
    const exportApi = await refreshSupabaseSession(request("/api/app/assets/export"));
    const reportApi = await refreshSupabaseSession(request("/api/app/reports/readiness/pdf"));

    expect(settings.headers.get("location")).toBe("https://compliancehub.example/app");
    expect(exportApi.status).toBe(403);
    await expect(exportApi.json()).resolves.toEqual({ error: "Workspace operator access required" });
    expect(reportApi.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["owner", "admin"] as const)("allows an authenticated %s through operational routes", async (role) => {
    hoisted.rows = [membership(ORG_A, role, "2026-01-01T00:00:00.000Z")];

    expect((await refreshSupabaseSession(request("/app/settings"))).headers.get("x-middleware-next")).toBe("1");
    expect((await refreshSupabaseSession(request("/api/app/tasks/export"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects users with a membership away from onboarding without creating a loop", async () => {
    hoisted.rows = [membership(ORG_A, "member", "2026-01-01T00:00:00.000Z")];

    const onboarding = await refreshSupabaseSession(request("/app/onboarding"));
    const home = await refreshSupabaseSession(request("/app"));

    expect(onboarding.headers.get("location")).toBe("https://compliancehub.example/app");
    expect(home.headers.get("x-middleware-next")).toBe("1");
  });

  it("fails closed with a safe 503 when membership resolution fails", async () => {
    hoisted.queryError = { message: "database host and credentials" };

    const response = await refreshSupabaseSession(request("/app"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Workspace access unavailable" });
  });

  it("preserves refreshed Supabase cookies when capability enforcement replaces the response", async () => {
    hoisted.rows = [membership(ORG_A, "member", "2026-01-01T00:00:00.000Z")];
    hoisted.refreshedCookies = [{
      name: "sb-access-token",
      value: "refreshed-session",
      options: { httpOnly: true, path: "/", sameSite: "lax" },
    }];

    const redirectResponse = await refreshSupabaseSession(request("/app/settings"));
    const forbiddenResponse = await refreshSupabaseSession(request("/api/app/tasks/export"));

    expect(redirectResponse.cookies.get("sb-access-token")?.value).toBe("refreshed-session");
    expect(forbiddenResponse.cookies.get("sb-access-token")?.value).toBe("refreshed-session");
  });
});
