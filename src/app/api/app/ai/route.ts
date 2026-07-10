import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { configuredAiProvider } from "@/features/ai/application/openai-compatible";
import { generateAiSuggestion } from "@/features/ai/application/suggestion";
import { buildAssessmentAiContext, buildAuditAiContext, buildAutomationProposalAiContext, buildEvidenceAiContext, buildReadinessAiContext, buildRiskAiContext, buildSoaAiContext, buildTaskAiContext } from "@/features/ai/domain/context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { loadReadinessInput } from "@/features/reports/application/load-readiness";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";

const requestSchema = z.discriminatedUnion("targetType", [
  z.object({ targetType: z.literal("assessment_question"), sessionId: z.string().uuid(), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("soa_item"), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("audit"), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("readiness_report") }),
  z.object({ targetType: z.literal("task"), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("evidence"), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("risk"), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("automation_proposal"), targetId: z.string().uuid() }),
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
  let suggestionType: "assessment_remediation" | "soa_rationale" | "audit_preparation" | "readiness_summary" | "task_remediation" | "evidence_review" | "risk_scenario" | "automation_explanation";
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
  } else if (parsed.data.targetType === "soa_item") {
    const { data: item } = await supabase.from("soa_items").select("id,control_code,control_title,applicable,status,soa_registers(organisation_id)").eq("id", parsed.data.targetId).maybeSingle();
    const register = Array.isArray(item?.soa_registers) ? item.soa_registers[0] : item?.soa_registers;
    if (!item || !register || register.organisation_id !== organisation.id) return NextResponse.json({ error: "SoA item not found" }, { status: 404 });
    targetId = item.id;
    suggestionType = "soa_rationale";
    context = buildSoaAiContext({ item: { id: item.id, controlCode: item.control_code, controlTitle: item.control_title, applicable: item.applicable, status: item.status } });
  } else if (parsed.data.targetType === "audit") {
    const { data: audit } = await supabase.from("audits").select("id,reference,title,status").eq("id", parsed.data.targetId).maybeSingle();
    if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    targetId = audit.id;
    suggestionType = "audit_preparation";
    context = buildAuditAiContext({ audit });
  } else if (parsed.data.targetType === "readiness_report") {
    const report = buildReadinessReport(await loadReadinessInput(supabase));
    targetId = organisation.id;
    suggestionType = "readiness_summary";
    context = buildReadinessAiContext({ organisationId: organisation.id, soaPercent: report.soaPercent, tasksOpen: report.tasksOpen, tasksOverdue: report.tasksOverdue, evidenceExpired: report.evidence.expired, openFindings: report.openNonConformities });
  } else if (parsed.data.targetType === "task") {
    const { data: task } = await supabase.from("tasks").select("id,title,status,source,due_on").eq("id", parsed.data.targetId).maybeSingle();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    targetId = task.id;
    suggestionType = "task_remediation";
    context = buildTaskAiContext({ task: { id: task.id, title: task.title, status: task.status, source: task.source, dueOn: task.due_on } });
  } else if (parsed.data.targetType === "evidence") {
    const { data: evidence } = await supabase.from("evidence").select("id,title,kind,status,collected_on,valid_until").eq("id", parsed.data.targetId).maybeSingle();
    if (!evidence) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
    targetId = evidence.id;
    suggestionType = "evidence_review";
    context = buildEvidenceAiContext({ evidence: { id: evidence.id, title: evidence.title, kind: evidence.kind, status: evidence.status, collectedOn: evidence.collected_on, validUntil: evidence.valid_until } });
  } else if (parsed.data.targetType === "risk") {
    const { data: risk } = await supabase.from("risks").select("id,reference,title,status,treatment").eq("id", parsed.data.targetId).eq("organisation_id", organisation.id).maybeSingle();
    if (!risk) return NextResponse.json({ error: "Risk not found" }, { status: 404 });
    targetId = risk.id;
    suggestionType = "risk_scenario";
    context = buildRiskAiContext({ risk });
  } else {
    const { data: proposal } = await supabase.from("automation_proposals")
      .select("id,target_type,output,automation_signals(id,signal_type,summary)").eq("id", parsed.data.targetId).eq("organisation_id", organisation.id).maybeSingle();
    const signal = Array.isArray(proposal?.automation_signals) ? proposal?.automation_signals[0] : proposal?.automation_signals;
    if (!proposal || !signal || !proposal.output || typeof proposal.output !== "object") return NextResponse.json({ error: "Automation draft not found" }, { status: 404 });
    const output = proposal.output as { title?: unknown; confidence?: unknown };
    const { data: sourceLink } = await supabase.from("automation_proposal_sources")
      .select("source_objects(id,title)").eq("proposal_id", proposal.id).eq("organisation_id", organisation.id).limit(1).maybeSingle();
    const source = Array.isArray(sourceLink?.source_objects) ? sourceLink.source_objects[0] : sourceLink?.source_objects;
    targetId = proposal.id;
    suggestionType = "automation_explanation";
    context = buildAutomationProposalAiContext({
      proposal: { id: proposal.id, targetType: proposal.target_type, title: typeof output.title === "string" ? output.title : "Automation draft", confidence: typeof output.confidence === "string" ? output.confidence : "low" },
      signal: { id: signal.id, type: signal.signal_type, summary: signal.summary },
      sourceObject: source ? { id: source.id, title: source.title } : null,
    });
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
