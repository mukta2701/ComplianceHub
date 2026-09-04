import { NextResponse } from "next/server";
import { consumeAuthorizationState } from "@/features/integrations/application/authorization-state";
import { completeJiraAuthorization, createJiraOAuthGateway } from "@/features/integrations/application/jira-oauth";
import {
  createSupabaseJiraConnectionStore,
  type JiraPersistenceDatabase,
} from "@/features/integrations/application/jira-token-store";
import { getJiraProviderConfig } from "@/features/integrations/application/provider-config";
import { hasCapability } from "@/features/organisations/domain/access";
import { requireAppContext } from "@/lib/app-context";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const statePattern = /^[A-Za-z0-9_-]{43}$/;

function settingsResult(
  result: "connection-failed" | "select-site" | "select-project",
  identity?: { kind: "setup" | "connection"; id: string },
): URL {
  const url = new URL("/app/integrations", siteUrl());
  url.searchParams.set("jira", result);
  if (identity) url.searchParams.set(identity.kind, identity.id);
  return url;
}

function validCode(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 512 && !/[\r\n]/.test(value);
}

export async function GET(request: Request) {
  const fail = () => NextResponse.redirect(settingsResult("connection-failed"));
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !statePattern.test(state) || !validCode(code) || url.searchParams.has("error")) return fail();

  try {
    const context = await requireAppContext();
    if (!hasCapability(context.membership.role, "manage_connections")) return fail();

    const config = getJiraProviderConfig();
    const database = createSupabaseServiceClient();
    await consumeAuthorizationState({
      database,
      provider: "jira",
      purpose: "jira_oauth",
      state,
      resolveOperator: async () => {
        const current = await requireAppContext();
        return {
          organisationId: current.organisation.id,
          userId: current.user.id,
          role: current.membership.role,
        };
      },
    });

    const result = await completeJiraAuthorization({
      gateway: createJiraOAuthGateway(config),
      store: createSupabaseJiraConnectionStore(database as unknown as JiraPersistenceDatabase),
      organisationId: context.organisation.id,
      userId: context.user.id,
      code,
    });
    if (result.nextStep === "select_site") {
      return NextResponse.redirect(settingsResult("select-site", { kind: "setup", id: result.setupId }));
    }
    return NextResponse.redirect(settingsResult("select-project", {
      kind: "connection",
      id: result.connectionId,
    }));
  } catch {
    return fail();
  }
}
