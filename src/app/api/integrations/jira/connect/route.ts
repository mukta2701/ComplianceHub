import { NextResponse } from "next/server";
import { issueAuthorizationState } from "@/features/integrations/application/authorization-state";
import { buildJiraAuthorizationUrl } from "@/features/integrations/application/jira-oauth";
import { getJiraProviderConfig } from "@/features/integrations/application/provider-config";
import { hasCapability } from "@/features/organisations/domain/access";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

function settingsResult(result: "setup-required" | "connection-failed"): URL {
  return new URL(`/app/integrations?jira=${result}`, siteUrl());
}

export async function GET() {
  const context = await requireAppContext();
  if (!hasCapability(context.membership.role, "manage_connections")) {
    return new Response(null, { status: 403 });
  }
  try {
    await enforceRateLimit(`provider-connect:${context.user.id}`, {
      limit: 10,
      windowMs: 60_000,
    });
  } catch {
    return new Response("Too many connection attempts. Please wait and try again.", { status: 429 });
  }

  let config: ReturnType<typeof getJiraProviderConfig>;
  try {
    config = getJiraProviderConfig();
  } catch {
    return NextResponse.redirect(settingsResult("setup-required"));
  }

  try {
    const database = createSupabaseServiceClient();
    const issued = await issueAuthorizationState({
      database,
      provider: "jira",
      purpose: "jira_oauth",
      resolveOperator: async () => {
        const current = await requireAppContext();
        return {
          organisationId: current.organisation.id,
          userId: current.user.id,
          role: current.membership.role,
        };
      },
    });
    return NextResponse.redirect(buildJiraAuthorizationUrl(config, issued.state));
  } catch {
    return NextResponse.redirect(settingsResult("connection-failed"));
  }
}
