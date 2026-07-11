import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { AssessmentResponseList } from "@/components/assessment-response-form";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { supabase } = await requireAppContext();
  const { data: session, error: sessionError } = await supabase.from("assessment_sessions").select("id,title,revision,catalogue_version_id").eq("id", id).single();
  if (sessionError) {
    if (sessionError.code === "PGRST116") notFound();
    throw new Error("Could not load assessment session");
  }
  if (!session) notFound();
  const [categoryResult, questionResult, responseResult] = await Promise.all([
    supabase.from("catalogue_categories").select("id,code,title,position").eq("catalogue_version_id", session.catalogue_version_id).order("position"),
    supabase.from("catalogue_questions").select("id,category_id,code,prompt,position").eq("catalogue_version_id", session.catalogue_version_id).order("position"),
    supabase.from("assessment_responses").select("question_id,answer,evidence_note").eq("session_id", id),
  ]);
  if (categoryResult.error || questionResult.error || responseResult.error) throw new Error("Could not load assessment questions and responses");
  const questionsByCategory = new Map<string, typeof questionResult.data>();
  for (const question of questionResult.data) questionsByCategory.set(question.category_id, [...(questionsByCategory.get(question.category_id) ?? []), question]);
  const questions = categoryResult.data.flatMap((category) => (questionsByCategory.get(category.id) ?? [])
    .sort((a, b) => a.position - b.position)
    .map((question) => ({ ...question, categoryCode: category.code, categoryTitle: category.title, categoryPosition: category.position })));
  if (questions.length !== questionResult.data.length) throw new Error("Assessment question is missing its catalogue category");
  return <>
    <PageIntro eyebrow="ASSESSMENT" title={session.title} body="Answers save automatically. A conflict is shown rather than overwriting newer work." />
    <AssessmentResponseList sessionId={id} questions={questions} initialRevision={session.revision} responses={responseResult.data} />
  </>;
}
