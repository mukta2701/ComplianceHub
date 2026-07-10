import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";

const schema = z.object({ status: z.enum(["accepted", "dismissed"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid review state" }, { status: 400 });
  const { id } = await params;
  const { supabase, user, organisation } = await requireAppContext();
  const { data, error } = await supabase.from("ai_suggestions").update({ status: parsed.data.status, reviewer_id: user.id }).eq("id", id).eq("organisation_id", organisation.id).eq("requester_id", user.id).select("id").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Draft not found or cannot be reviewed" }, { status: 404 });
  return NextResponse.json({ status: parsed.data.status });
}
