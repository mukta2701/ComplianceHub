import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { AssessmentResponseList } from "@/components/assessment-response-form";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { supabase } = await requireAppContext();
  const { data: session } = await supabase.from("assessment_sessions").select("id,title,revision,catalogue_version_id").eq("id", id).single(); if (!session) notFound();
  const [{ data: questions }, { data: responses }] = await Promise.all([supabase.from("catalogue_questions").select("id,code,prompt,position").eq("catalogue_version_id", session.catalogue_version_id).order("position"), supabase.from("assessment_responses").select("question_id,answer,evidence_note").eq("session_id", id)]);
  return <main className="mx-auto max-w-4xl px-6 py-10"><h1 className="text-3xl font-bold">{session.title}</h1><p className="mt-2 text-slate-600">Answers save automatically. A conflict is shown rather than overwriting newer work.</p><div className="mt-8"><AssessmentResponseList sessionId={id} questions={questions??[]} initialRevision={session.revision} responses={responses??[]}/></div></main>;
}
