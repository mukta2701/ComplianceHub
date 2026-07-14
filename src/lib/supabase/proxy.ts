import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnvironment } from "./env";
import { ACTIVE_ORGANISATION_COOKIE, parseActiveOrganisationId } from "@/lib/active-workspace";
import { workspaceRequestAccess, type WorkspaceAccessDecision } from "@/features/organisations/domain/portal-access";
import type { MembershipRole } from "@/features/organisations/domain/access";

type RequestMembership = {
  organisation_id: string;
  role: MembershipRole;
  created_at: string;
};

function withRefreshedCookies(source: NextResponse, target: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

function accessResponse(
  request: NextRequest,
  refreshed: NextResponse,
  decision: WorkspaceAccessDecision,
): NextResponse {
  switch (decision) {
    case "allow":
      return refreshed;
    case "redirect-sign-in":
      return withRefreshedCookies(refreshed, NextResponse.redirect(new URL("/sign-in", request.url)));
    case "redirect-onboarding":
      return withRefreshedCookies(refreshed, NextResponse.redirect(new URL("/app/onboarding", request.url)));
    case "redirect-member-home":
      return withRefreshedCookies(refreshed, NextResponse.redirect(new URL("/app", request.url)));
    case "unauthorized":
      return withRefreshedCookies(refreshed, NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers: { "cache-control": "private, no-store" } },
      ));
    case "forbidden":
      return withRefreshedCookies(refreshed, NextResponse.json(
        { error: "Workspace operator access required" },
        { status: 403, headers: { "cache-control": "private, no-store" } },
      ));
  }
}

async function resolveRequestMembership(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  preferredOrganisationId: string | null,
): Promise<{ membership: RequestMembership | null; error: boolean }> {
  const membershipQuery = () => supabase
    .from("memberships")
    .select("organisation_id,role,created_at")
    .eq("user_id", userId);

  if (preferredOrganisationId) {
    const { data, error } = await membershipQuery()
      .eq("organisation_id", preferredOrganisationId)
      .maybeSingle();
    if (error) return { membership: null, error: true };
    if (data) return { membership: data as RequestMembership, error: false };
  }

  const { data, error } = await membershipQuery()
    .order("created_at", { ascending: true })
    .order("organisation_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  return { membership: (data as RequestMembership | null) ?? null, error: Boolean(error) };
}

export async function refreshSupabaseSession(request: NextRequest) {
  const environment = getSupabasePublicEnvironment();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser verifies the token and refreshes expired sessions when required.
  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isWorkspaceRequest = pathname === "/app"
    || pathname.startsWith("/app/")
    || pathname === "/api/app"
    || pathname.startsWith("/api/app/");
  if (!isWorkspaceRequest) return response;

  if (!user) {
    return accessResponse(request, response, workspaceRequestAccess(pathname, {
      authenticated: false,
      role: null,
    }));
  }

  const preferredOrganisationId = parseActiveOrganisationId(
    request.cookies.get(ACTIVE_ORGANISATION_COOKIE)?.value,
  );
  const resolved = await resolveRequestMembership(supabase, user.id, preferredOrganisationId);
  if (resolved.error) {
    return withRefreshedCookies(response, NextResponse.json(
      { error: "Workspace access unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    ));
  }

  return accessResponse(request, response, workspaceRequestAccess(pathname, {
    authenticated: true,
    role: resolved.membership?.role ?? null,
  }));
}
