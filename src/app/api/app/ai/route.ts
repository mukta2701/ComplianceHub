import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { configuredAiProvider } from "@/features/ai/application/openai-compatible";
import { generateAiSuggestion } from "@/features/ai/application/suggestion";
import { buildAssessmentAiContext, buildSoaAiContext } from "@/features/ai/domain/context";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const requestSchema = z.discriminatedUnion("targetType", [
  z.object({ targetType: z.literal("assessment_question"), sessionId: z.string().uuid(), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("soa_item"), targetId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`ai-draft:${user.id}`, { limit: 20, windowMs: 60 * 60_000 });
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid AI request" }, { status: 400 });
  const { data: settings } = await supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle();
  if (!settings?.enabled) return NextResponse.json({ error: "AI assistance is disabled for this workspace" }, { status: 403 });
  const provider = configuredAiProvider();
  if (!provider) return NextResponse.json({ error: "AI assistance is not configured" }, { status: 503 });

  let targetId: string;
  let suggestionType: "assessment_remediation" | "soa_rationale";
  let context;
  if (parsed.data.targetType === "assessment_question") {
    const [{ data: session }, { data: question }, { data: response }] = await Promise.all([
      supabase.from("assessment_sessions").select("id,organisation_id").eq("id", parsed.data.sessionId).maybeSingle(),
      supabase.from("catalogue_questions").select("id,code,prompt").eq("id", parsed.data.targetId).maybeSingle(),
      supabase.from("assessment_responses").select("answer").eq("session_id", parsed.data.sessionId).eq("question_id", parsed.data.targetId).maybeSingle(),
    ]);
    if (!session || session.organisation_id !== organisation.id || !question) return NextResponse.json({ error: "Assessment record not found" }, { status: 404 });
    targetId = question.id;
    suggestionType = "assessment_remediation";
    context = buildAssessmentAiContext({ sessionId: session.id, question, answer: response?.answer ?? null });
  } else {
    const { data: item } = await supabase.from("soa_items").select("id,control_code,control_title,applicable,status,soa_registers(organisation_id)").eq("id", parsed.data.targetId).maybeSingle();
    const register = Array.isArray(item?.soa_registers) ? item.soa_registers[0] : item?.soa_registers;
    if (!item || !register || register.organisation_id !== organisation.id) return NextResponse.json({ error: "SoA item not found" }, { status: 404 });
    targetId = item.id;
    suggestionType = "soa_rationale";
    context = buildSoaAiContext({ item: { id: item.id, controlCode: item.control_code, controlTitle: item.control_title, applicable: item.applicable, status: item.status } });
  }

  try {
    const suggestion = await generateAiSuggestion({ provider, context });
    const { data, error } = await supabase.from("ai_suggestions").insert({
      organisation_id: organisation.id, target_type: parsed.data.targetType, target_id: targetId, suggestion_type: suggestionType,
      requester_id: user.id, input_snapshot: context, output: suggestion, source_references: suggestion.sourceReferences,
    }).select("id,status,output,source_references").single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Could not generate a draft. Use the deterministic guidance instead." }, { status: 502 });
  }
}
