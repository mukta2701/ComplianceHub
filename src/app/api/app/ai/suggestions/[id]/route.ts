import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";

const schema = z.object({ status: z.enum(["accepted", "dismissed"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid review state" }, { status: 400 });
  const { id } = await params;
  const { supabase, user } = await requireAppContext();
  const { error } = await supabase.from("ai_suggestions").update({ status: parsed.data.status, reviewer_id: user.id }).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not update draft review state" }, { status: 403 });
  return NextResponse.json({ status: parsed.data.status });
}
