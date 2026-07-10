import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/security/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { syncTickets } from "@/features/integrations/application/sync-run";

export const dynamic = "force-dynamic";

async function sync(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  return NextResponse.json(await syncTickets(supabase));
}

export async function GET(request: Request) { return sync(request); }
export async function POST(request: Request) { return sync(request); }
