import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveAssessmentResponse } from "@/features/assessment/application/autosave";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try { await enforceRateLimit(`autosave:${user.id}`, { limit: 120, windowMs: 60_000 }); const result = await saveAssessmentResponse(await request.json(), { save: async (input) => { const { data, error } = await supabase.rpc("save_assessment_response", { target_session_id: input.sessionId, target_question_id: input.questionId, target_answer: input.answer, target_evidence_note: input.evidenceNote, expected_revision: input.expectedRevision }); if (error) throw error; return { revision: Number(data) }; } }); return NextResponse.json(result); }
  catch (error) { const conflict = error instanceof Error && "code" in error && error.code === "ASSESSMENT_REVISION_CONFLICT"; return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: conflict ? 409 : 400 }); }
}
