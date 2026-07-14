import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

// Liveness + DB-connectivity probe for an external uptime monitor. Returns 200
// only when the app can reach Supabase; 503 otherwise so the monitor alerts.
export async function GET() {
  const started = Date.now();
  try {
    const supabase = createSupabaseServiceClient();
    // Cheap round-trip against the existing service-role-only error store. This
    // table is present in every hardened deployment and already grants SELECT
    // to service_role, so the probe needs no additional database privileges.
    const { error } = await supabase.from("app_errors").select("id", { head: true, count: "exact" }).limit(1);
    if (error) throw error;
    return NextResponse.json({ status: "ok", db: "ok", ms: Date.now() - started });
  } catch (error) {
    await logError("route", "health check failed", error);
    return NextResponse.json({ status: "degraded", db: "error", ms: Date.now() - started }, { status: 503 });
  }
}
