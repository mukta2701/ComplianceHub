import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { AssessmentResponseList } from "@/components/assessment-response-form";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { supabase } = await requireAppContext();
  const { data: session } = await supabase.from("assessment_sessions").select("id,title,revision,catalogue_version_id").eq("id", id).single(); if (!session) notFound();
  const [{ data: questions }, { data: responses }] = await Promise.all([
    supabase.from("catalogue_questions").select("id,code,prompt,position").eq("catalogue_version_id", session.catalogue_version_id).order("position"),
    supabase.from("assessment_responses").select("question_id,answer,evidence_note").eq("session_id", id),
  ]);
  return <>
    <PageIntro eyebrow="ASSESSMENT" title={session.title} body="Answers save automatically. A conflict is shown rather than overwriting newer work." />
    <AssessmentResponseList sessionId={id} questions={questions ?? []} initialRevision={session.revision} responses={responses ?? []} />
  </>;
}
