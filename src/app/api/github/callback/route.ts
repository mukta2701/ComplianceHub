import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createAppJwt } from "@/features/github/application/github-app-auth";
import { resolveGitHubAccountType } from "@/features/github/application/github-account-policy";
import {
  collectUserInstallationRepositories,
  exchangeGitHubUserCode,
  getAppInstallation,
  listUserInstallationIds,
  parseOAuthFlowCookie,
} from "@/features/github/application/github-user-oauth";
import { claimInstallation } from "@/features/github/application/installation-claim";
import { hasCapability } from "@/features/organisations/domain/access";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
const GITHUB_OAUTH_COOKIE = "compliancehub_github_oauth";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

type ErrorCode = "invalid_request" | "not_authorized" | "rate_limited" | "configuration_error" | "verification_failed";
const INVALID_QUERY_VALUE = Symbol("invalid-query-value");

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

function errorRedirect(code: ErrorCode): NextResponse {
  return redirectTo(canonicalSiteUrl(`/app/integrations?github=${code}`));
}

function configurationErrorRedirect(): NextResponse {
  try {
    return errorRedirect("configuration_error");
  } catch {
    return new NextResponse(null, {
      status: 303,
      headers: {
        ...RESPONSE_HEADERS,
        Location: "/app/integrations?github=configuration_error",
      },
    });
  }
}

function sourceClass(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  if (!forwarded) return "unknown";
  return forwarded.includes(":") ? "ipv6" : "ipv4";
}

function onlyValue(url: URL, key: string, required: boolean): string | null | typeof INVALID_QUERY_VALUE {
  const values = url.searchParams.getAll(key);
  if (values.length === 0) return required ? INVALID_QUERY_VALUE : null;
  if (values.length !== 1 || !values[0]) return INVALID_QUERY_VALUE;
  return values[0];
}

function readCallback(url: URL): { code: string; state: string; installationId: number | null } | null {
  for (const key of url.searchParams.keys()) {
    if (key !== "code" && key !== "state" && key !== "installation_id") return null;
  }
  const code = onlyValue(url, "code", true);
  const state = onlyValue(url, "state", true);
  const installation = onlyValue(url, "installation_id", false);
  if (code === INVALID_QUERY_VALUE || state === INVALID_QUERY_VALUE || installation === INVALID_QUERY_VALUE || code === null || state === null) return null;
  if (code.length > 1_000 || state.length > 200) return null;
  if (installation === null) return { code, state, installationId: null };
  if (!/^[1-9][0-9]*$/.test(installation)) return null;
  const installationId = Number(installation);
  return Number.isSafeInteger(installationId) ? { code, state, installationId } : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  // The one-time browser binding is erased before any awaited authentication,
  // database, or GitHub work, including every error path after this point.
  const store = await cookies();
  const cookieValue = store.get(GITHUB_OAUTH_COOKIE)?.value;
  store.set(GITHUB_OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/github",
    maxAge: 0,
  });

  const callback = readCallback(new URL(request.url));
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!callback || !cookieValue || !clientSecret) return errorRedirect("invalid_request");

  let flow;
  try {
    flow = parseOAuthFlowCookie(cookieValue, clientSecret);
  } catch {
    return errorRedirect("invalid_request");
  }
  if (callback.state !== flow.state || (callback.installationId !== null && callback.installationId !== flow.pendingInstallationId)) {
    return errorRedirect("invalid_request");
  }

  let context: Awaited<ReturnType<typeof requireAppContext>>;
  try {
    context = await requireAppContext();
  } catch {
    return redirectTo(canonicalSiteUrl("/sign-in"));
  }
  if (
    context.user.id !== flow.actorId
    || context.organisation.id !== flow.organisationId
    || !hasCapability(context.membership.role, "manage_connections")
  ) return errorRedirect("not_authorized");

  try {
    await enforceRateLimit(`github-callback:${context.user.id}:${sourceClass(request)}`, { limit: 10, windowMs: 10 * 60_000 });
  } catch {
    return errorRedirect("rate_limited");
  }

  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const allowedAccountId = Number(process.env.GITHUB_ALLOWED_ACCOUNT_ID);
  if (!clientId || !appId || !privateKey || !Number.isSafeInteger(allowedAccountId) || allowedAccountId <= 0) {
    return configurationErrorRedirect();
  }
  let allowedAccountType;
  try {
    allowedAccountType = resolveGitHubAccountType({
      configuredType: process.env.GITHUB_ALLOWED_ACCOUNT_TYPE,
      nodeEnv: process.env.NODE_ENV,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    });
  } catch {
    return configurationErrorRedirect();
  }

  try {
    const stateHash = createHash("sha256").update(callback.state, "utf8").digest("hex");
    const service = createSupabaseServiceClient();
    const { data: consumed, error: consumeError } = await service.rpc("consume_github_oauth_state_server", {
      target_state_hash: stateHash,
      target_organisation_id: flow.organisationId,
      target_actor_id: flow.actorId,
      target_pending_provider_installation_id: flow.pendingInstallationId,
    });
    if (consumeError || consumed !== true) return errorRedirect("invalid_request");

    const callbackUrl = canonicalSiteUrl("/api/github/callback").toString();
    const userToken = await exchangeGitHubUserCode({
      clientId,
      clientSecret,
      code: callback.code,
      callbackUrl,
      codeVerifier: flow.codeVerifier,
    });
    const appJwt = await createAppJwt({ appId, privateKey }, new Date());
    const [userInstallationIds, appInstallation, repositories] = await Promise.all([
      listUserInstallationIds({ userToken }),
      getAppInstallation({ appJwt, installationId: flow.pendingInstallationId }),
      collectUserInstallationRepositories({ userToken, installationId: flow.pendingInstallationId }),
    ]);
    await claimInstallation(
      {
        organisationId: flow.organisationId,
        actorId: flow.actorId,
        requestedInstallationId: flow.pendingInstallationId,
        userInstallationIds,
        appInstallation,
        repositories,
      },
      { allowedAccountType },
    );
    return redirectTo(canonicalSiteUrl("/app/integrations?github=connected"));
  } catch {
    return errorRedirect("verification_failed");
  }
}
