import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { buildGitHubAuthorizeUrl, createOAuthFlow } from "@/features/github/application/github-user-oauth";
import { hasCapability } from "@/features/organisations/domain/access";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const GITHUB_OAUTH_COOKIE = "compliancehub_github_oauth";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function canonicalSiteUrl(path: string): URL {
  const configured = new URL(siteUrl());
  const localHttp = configured.protocol === "http:" && (configured.hostname === "localhost" || configured.hostname === "127.0.0.1");
  if ((configured.protocol !== "https:" && !localHttp) || configured.username || configured.password || configured.search || configured.hash) {
    throw new Error("Invalid site URL");
  }
  return new URL(path, `${configured.origin}/`);
}

function redirectTo(url: URL): NextResponse {
  return NextResponse.redirect(url, { status: 303, headers: RESPONSE_HEADERS });
}

function errorRedirect(code: "not_authorized" | "invalid_request" | "rate_limited" | "configuration_error"): NextResponse {
  return redirectTo(canonicalSiteUrl(`/app/integrations?github=${code}`));
}

function sourceClass(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  if (!forwarded) return "unknown";
  // Coarse source class is deliberately not a raw address and is used only as
  // a secondary limiter dimension beside the authenticated actor.
  return forwarded.includes(":") ? "ipv6" : "ipv4";
}

function readInstallationId(url: URL): number | null | "invalid" {
  for (const key of url.searchParams.keys()) {
    if (key !== "installation_id" && key !== "setup_action") return "invalid";
  }
  const setupActions = url.searchParams.getAll("setup_action");
  if (setupActions.length > 1 || (setupActions.length === 1 && !["install", "update"].includes(setupActions[0] ?? ""))) {
    return "invalid";
  }
  const values = url.searchParams.getAll("installation_id");
  if (values.length === 0) return null;
  if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0] ?? "")) return "invalid";
  const id = Number(values[0]);
  return Number.isSafeInteger(id) ? id : "invalid";
}

export async function GET(request: Request): Promise<NextResponse> {
  let context: Awaited<ReturnType<typeof requireAppContext>>;
  try {
    context = await requireAppContext();
  } catch {
    return redirectTo(canonicalSiteUrl("/sign-in"));
  }
  if (!hasCapability(context.membership.role, "manage_connections")) return errorRedirect("not_authorized");

  try {
    await enforceRateLimit(`github-setup:${context.user.id}:${sourceClass(request)}`, { limit: 10, windowMs: 10 * 60_000 });
  } catch {
    return errorRedirect("rate_limited");
  }

  const installationId = readInstallationId(new URL(request.url));
  if (installationId === "invalid") return errorRedirect("invalid_request");

  const slug = process.env.GITHUB_APP_SLUG;
  const allowedAccountId = Number(process.env.GITHUB_ALLOWED_ACCOUNT_ID);
  if (
    !slug
    || !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(slug)
    || !Number.isSafeInteger(allowedAccountId)
    || allowedAccountId <= 0
  ) return errorRedirect("configuration_error");
  if (installationId === null) return redirectTo(new URL(`/apps/${slug}/installations/new`, "https://github.com"));

  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return errorRedirect("configuration_error");

  try {
    const callbackUrl = canonicalSiteUrl("/api/github/callback").toString();
    const flow = createOAuthFlow({
      organisationId: context.organisation.id,
      actorId: context.user.id,
      pendingInstallationId: installationId,
      clientSecret,
    });
    const service = createSupabaseServiceClient();
    const { error } = await service.from("github_oauth_states").insert({
      organisation_id: context.organisation.id,
      actor_id: context.user.id,
      pending_provider_installation_id: installationId,
      state_hash: flow.stateHash,
      expires_at: flow.expiresAt,
    });
    if (error) throw new Error("state insert failed");

    const store = await cookies();
    store.set(GITHUB_OAUTH_COOKIE, flow.cookieValue, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/github",
      maxAge: 600,
    });
    return redirectTo(buildGitHubAuthorizeUrl({
      clientId,
      callbackUrl,
      state: flow.state,
      codeChallenge: flow.codeChallenge,
    }));
  } catch {
    return errorRedirect("configuration_error");
  }
}
