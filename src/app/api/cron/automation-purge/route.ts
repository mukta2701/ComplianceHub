import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { purgeContentReference, shouldPurgeSourceObject } from "@/features/automation/domain/retention";

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function purge(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  const now = new Date();
  const { data: objects, error } = await supabase.from("source_objects")
    .select("id,organisation_id,status,expires_at,content_hash").eq("status", "pending").lte("expires_at", now.toISOString());
  if (error) throw error;
  let purged = 0;
  for (const object of objects ?? []) {
    if (!shouldPurgeSourceObject({ status: object.status, expiresAt: object.expires_at }, now)) continue;
    const { error: updateError } = await supabase.from("source_objects")
      .update({ status: "purged", purged_at: now.toISOString(), content_ref: purgeContentReference(object.content_hash) })
      .eq("id", object.id).eq("organisation_id", object.organisation_id).eq("status", "pending");
    if (updateError) throw updateError;
    purged += 1;
  }
  return NextResponse.json({ purged });
}

export async function GET(request: Request) { return purge(request); }
export async function POST(request: Request) { return purge(request); }
