import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";

const inputSchema = z.object({ sessionId: z.uuid(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
const failures: Record<string, { status: number; error: string }> = {
  "40001": { status: 409, error: "This assessment changed elsewhere. Reload it before completing." },
  "23514": { status: 422, error: "Answer every assessment question before completing." },
  "P0002": { status: 404, error: "Assessment not found in the active workspace." },
};

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const membership = await getMembership();
  const assessmentAccess = workspaceAccess(membership?.role ?? null).section("assessments");
  if (!membership || !assessmentAccess.canManage) {
    return NextResponse.json({ error: assessmentAccess.manageDeniedMessage }, { status: 403 });
  }
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid completion request" }, { status: 400 }); }
  const parsed = inputSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid completion request" }, { status: 400 });
  try {
    await enforceRateLimit(`assessment-complete:${user.id}`, { limit: 20, windowMs: 60_000 });
    const { data, error } = await supabase.rpc("complete_assessment", {
      target_organisation_id: membership.organisation_id,
      target_session_id: parsed.data.sessionId,
      expected_revision: parsed.data.expectedRevision,
    });
    if (error) {
      const failure = error.code === "42501"
        ? { status: 403, error: assessmentAccess.manageDeniedMessage }
        : failures[error.code];
      if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
      throw error;
    }
    if (data === null) throw new Error("Missing completion result");
    revalidatePath("/app/assessment");
    revalidatePath(`/app/assessment/${parsed.data.sessionId}`);
    revalidatePath("/app");
    return NextResponse.json({ state: "completed", revision: Number(data) });
  } catch {
    return NextResponse.json({ error: "Could not complete the assessment. Please retry." }, { status: 500 });
  }
}
