import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";

type Row = { code: string; prompt: string; answer: string; evidence_note: string };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const requestedSessionId = url.searchParams.get("sessionId");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  let sessionId = requestedSessionId;
  let catalogueVersionId: string | null = null;
  if (sessionId) {
    const { data: session } = await supabase.from("assessment_sessions").select("id,catalogue_version_id").eq("id", sessionId).maybeSingle();
    if (!session) return NextResponse.json({ error: "No assessment session found" }, { status: 404 });
    catalogueVersionId = session.catalogue_version_id;
  } else {
    const { data: latest } = await supabase.from("assessment_sessions").select("id,catalogue_version_id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest) return NextResponse.json({ error: "No assessment session found" }, { status: 404 });
    sessionId = latest.id;
    catalogueVersionId = latest.catalogue_version_id;
  }
  const [{ data: questions }, { data: responses }] = await Promise.all([
    supabase.from("catalogue_questions").select("id,code,prompt,position").eq("catalogue_version_id", catalogueVersionId).order("position"),
    supabase.from("assessment_responses").select("question_id,answer,evidence_note").eq("session_id", sessionId),
  ]);
  const responseByQuestion = new Map<string, { answer: string | null; evidence_note: string | null }>();
  for (const r of responses ?? []) responseByQuestion.set(r.question_id, { answer: r.answer, evidence_note: r.evidence_note });
  const rows: Row[] = (questions ?? []).map((q) => {
    const response = responseByQuestion.get(q.id);
    return { code: q.code, prompt: q.prompt, answer: response?.answer ?? "", evidence_note: response?.evidence_note ?? "" };
  });
  const columns: ExportColumn<Row>[] = [
    { header: "Question Code", value: (q) => q.code },
    { header: "Prompt", value: (q) => q.prompt },
    { header: "Answer", value: (q) => q.answer },
    { header: "Evidence Note", value: (q) => q.evidence_note },
  ];
  if (format === "csv") return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="assessment.csv"', "cache-control": "private, no-store" } });
  const buffer = await toXlsx("Assessment", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="assessment.xlsx"', "cache-control": "private, no-store" } });
}
