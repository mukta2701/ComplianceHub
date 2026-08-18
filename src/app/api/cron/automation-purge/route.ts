import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { purgeContentReference, shouldPurgeSourceObject } from "@/features/automation/domain/retention";
import { isAuthorisedCron } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
const PURGE_BATCH_SIZE = 100;

async function purge(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  const now = new Date();
  const { data: objects, error } = await supabase.from("source_objects")
    .select("id,organisation_id,status,expires_at,content_hash")
    .eq("status", "pending")
    .lte("expires_at", now.toISOString())
    .limit(PURGE_BATCH_SIZE + 1);
  if (error) throw error;
  const batch = (objects ?? []).slice(0, PURGE_BATCH_SIZE);
  const deferred = Math.max((objects?.length ?? 0) - batch.length, 0);
  let purged = 0;
  for (const object of batch) {
    if (!shouldPurgeSourceObject({ status: object.status, expiresAt: object.expires_at }, now)) continue;
    const { error: updateError } = await supabase.from("source_objects")
      .update({ status: "purged", purged_at: now.toISOString(), content_ref: purgeContentReference(object.content_hash) })
      .eq("id", object.id).eq("organisation_id", object.organisation_id).eq("status", "pending");
    if (updateError) throw updateError;
    purged += 1;
  }
  return NextResponse.json({ purged, deferred });
}

export async function GET(request: Request) { return purge(request); }
export async function POST(request: Request) { return purge(request); }
