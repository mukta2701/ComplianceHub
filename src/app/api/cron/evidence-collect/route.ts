import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/security/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { collectEvidence } from "@/features/integrations/application/collect-run";

export const dynamic = "force-dynamic";

async function collect(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  return NextResponse.json(await collectEvidence(supabase));
}

export async function GET(request: Request) { return collect(request); }
export async function POST(request: Request) { return collect(request); }
