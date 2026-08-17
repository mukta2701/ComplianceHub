import { NextResponse } from "next/server";
import { getMcpOAuthConfig } from "@/features/mcp/auth/oauth-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getMcpOAuthConfig();
  return NextResponse.json({
    resource: config.resource,
    authorization_servers: [config.authorizationServer],
    scopes_supported: config.scopes,
    bearer_methods_supported: ["header"],
  }, { headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}
