import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/security/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildMonitorDependencies } from "@/features/monitoring/application/monitor-deps";
import { drainSupabaseSlackAlertDeliveries } from "@/features/monitoring/application/slack-alert-store";
import { runMonitoring } from "@/features/monitoring/application/monitor-run";
import { logError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Continuous monitoring — runs daily at 07:00 UTC (vercel.json). Watches every org's
// connected sources, raises/re-opens/auto-resolves findings, and alerts in-app +
// to external channels. The per-org "Run checks now" button shares the same
// dependency builder (monitor-deps) so manual and scheduled runs behave identically.
async function monitor(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  try {
    const supabase = createSupabaseServiceClient();
    const alertRetries = await drainSupabaseSlackAlertDeliveries(supabase);
    const summary = await runMonitoring(buildMonitorDependencies(supabase));
    return NextResponse.json({ ...summary, alertRetries });
  } catch (error) {
    await logError("cron", "monitor cron failed", error);
    return NextResponse.json({ error: "monitor run failed" }, { status: 500 });
  }
}

export async function GET(request: Request) { return monitor(request); }
export async function POST(request: Request) { return monitor(request); }
