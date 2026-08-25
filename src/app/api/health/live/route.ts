import { NextResponse } from "next/server";
import { complianceHubRuntimeCapabilities } from "@/features/mcp/application/runtime-capabilities";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok", ...complianceHubRuntimeCapabilities() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
