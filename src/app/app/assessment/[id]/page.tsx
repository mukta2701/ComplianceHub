import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro, Pill } from "@/components/ui";
import { AssessmentResponseList } from "@/components/assessment-response-form";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";
import { createSoaAction } from "../../actions";

const REVIEW_READ_LIMIT = 100;
const RELATED_READ_LIMIT = 5_000;

function isCompleteResult<T>(result: { data: T[] | null; error: unknown; count: number | null }): result is { data: T[]; error: null; count: number } {
  return !result.error && result.data !== null && result.count !== null && result.count === result.data.length;
}

export default async function AssessmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ completed?: string }> }) {
  const { id } = await params;
  const completed = (await searchParams)?.completed === "1";
  const { supabase, organisation, membership } = await requireAppContext();
  const assessmentAccess = workspaceAccess(membership.role).section("assessments");
  const { data: session, error: sessionError } = await supabase.from("assessment_sessions").select("id,title,state,revision,catalogue_version_id").eq("id", id).eq("organisation_id", organisation.id).single();
  if (sessionError) {
    if (sessionError.code === "PGRST116") notFound();
    throw new Error("Could not load assessment session");
  }
  if (!session) notFound();
  const [categoryResult, questionResult, responseResult, aiSettingsResult, reviewResult] = await Promise.all([
    supabase.from("catalogue_categories").select("id,code,title,position", { count: "exact" }).eq("catalogue_version_id", session.catalogue_version_id).order("position").limit(RELATED_READ_LIMIT),
    supabase.from("catalogue_questions").select("id,category_id,code,prompt,position", { count: "exact" }).eq("catalogue_version_id", session.catalogue_version_id).order("position").limit(RELATED_READ_LIMIT),
    supabase.from("assessment_responses").select("question_id,answer,evidence_note", { count: "exact" }).eq("session_id", id).eq("organisation_id", organisation.id).limit(RELATED_READ_LIMIT),
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
    supabase.from("soa_registers").select("id,assessment_session_id,version,updated_at,soa_snapshots!soa_snapshots_register_tenant_fk(id)", { count: "exact" }).eq("assessment_session_id", id).eq("organisation_id", organisation.id).order("updated_at", { ascending: false }).order("version", { ascending: false }).order("id", { ascending: false }).limit(REVIEW_READ_LIMIT),
  ]);
  if (!isCompleteResult(categoryResult) || !isCompleteResult(questionResult) || !isCompleteResult(responseResult)) return <>
    <PageIntro eyebrow="GAP ASSESSMENT" title={session.title} body="The complete assessment record could not be loaded." />
    <section className="assessment-unavailable" aria-labelledby="assessment-detail-unavailable-title">
      <div><h2 id="assessment-detail-unavailable-title">Assessment details unavailable</h2><p>We could not verify the complete question and response set. No partial totals or answers are shown.</p></div>
      <Link className="button secondary" href={`/app/assessment/${id}`}>Retry</Link>
    </section>
  </>;
  const questionsByCategory = new Map<string, typeof questionResult.data>();
  for (const question of questionResult.data) questionsByCategory.set(question.category_id, [...(questionsByCategory.get(question.category_id) ?? []), question]);
  const questions = categoryResult.data.flatMap((category) => (questionsByCategory.get(category.id) ?? [])
    .sort((a, b) => a.position - b.position)
    .map((question) => ({ ...question, categoryCode: category.code, categoryTitle: category.title, categoryPosition: category.position })));
  if (questions.length !== questionResult.data.length) throw new Error("Assessment question is missing its catalogue category");
  const reviewStatusAvailable = !reviewResult.error && reviewResult.data !== null && reviewResult.count !== null && reviewResult.count === reviewResult.data.length;
  const activeReview = reviewStatusAvailable ? reviewResult.data.find((review) => review.soa_snapshots.length === 0) : null;
  const answered = responseResult.data.filter((response) => response.answer !== null).length;
  const missingNotes = responseResult.data.filter((response) => response.answer !== null && response.evidence_note.trim().length === 0).length;
  const isMember = !assessmentAccess.canManage;
  const controlReviewHref = activeReview ? `/app/soa/${activeReview.id}` : undefined;
  return <>
    <PageIntro eyebrow="GAP ASSESSMENT" title={session.title} body={session.state === "completed" ? "This assessment is complete. It records current practice and supporting notes for review." : isMember ? "Review the recorded answers and supporting notes. Ask a workspace operator to make changes." : "Answer each question from current practice. Answers and supporting notes save as you go."} action={<Pill tone={session.state === "completed" ? "green" : "amber"}>{session.state === "completed" ? "Completed" : "In progress"}</Pill>} />
    {completed && session.state === "completed" && <div className="assessment-notice" role="status" aria-label="Completion status"><strong>Assessment completed.</strong> The recorded answers are ready to use as source context for control review.</div>}
    <section className="assessment-journey" aria-label="Assessment to controls journey">
      <ol>
        <li data-current="true"><span>1</span><div><h2>Gap assessment</h2><p>{answered} of {questions.length} answered · {missingNotes} {missingNotes === 1 ? "supporting note missing" : "supporting notes missing"}</p></div></li>
        <li><span>2</span><div><h2>Control review</h2><p>Work through the 93 ISO controls. For each one, a reviewer records whether it applies, its progress, owner, reason and evidence.</p></div></li>
        <li><span>3</span><div><h2>Statement of Applicability</h2><p>A formal version is created only after the control decisions pass review.</p></div></li>
      </ol>
      <div className="assessment-journey-action">
        {!reviewStatusAvailable ? <div className="assessment-review-unavailable"><div><h2>Control review status unavailable</h2><p>We could not verify whether an active review already exists.</p></div><Link className="button secondary" href={`/app/assessment/${id}`}>Retry</Link></div>
          : activeReview ? <><p>{isMember ? "Open the connected review to read its current control decisions." : `Continue the connected version ${activeReview.version} control review.`}</p><Link className="button primary" href={controlReviewHref!}>{isMember ? "View control review" : "Resume control review"}</Link></>
          : isMember ? <p>A workspace operator can start the control review. You can read it here after it is created.</p>
          : <><p>{session.state === "completed" ? "Use these answers as source context. They have not made any control decisions." : "You can start now, but the control review will use incomplete source context until every assessment question is answered."}</p><form action={createSoaAction}><input type="hidden" name="assessmentId" value={id} /><button className="button primary">Review controls</button></form></>}
      </div>
    </section>
    <AssessmentResponseList aiEnabled={!aiSettingsResult.error && aiSettingsResult.data?.enabled === true} readOnly={session.state === "completed" || isMember} sessionId={id} questions={questions} initialRevision={session.revision} responses={responseResult.data} />
  </>;
}
