import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { EmptyState, ModuleExplainer, PageIntro, Pill } from "@/components/ui";
import { getModuleGuidance } from "@/features/education/domain/guidance";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";
import { createAssessmentAction } from "../actions";

const ASSESSMENT_DISPLAY_LIMIT = 50;
const RELATED_READ_LIMIT = 5_000;

type AssessmentRegisterItem = {
  id: string;
  title: string;
  state: "draft" | "completed";
  revision: number;
  updatedAt: string;
  answered: number;
  questions: number;
  missingEvidenceNotes: number;
  activeReviewId: string | null;
  activeReviewVersion: number | null;
};

function isCompleteResult<T>(result: { data: T[] | null; error: unknown; count: number | null }): result is { data: T[]; error: null; count: number } {
  return !result.error && result.data !== null && result.count !== null && result.count === result.data.length;
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function RegisterUnavailable() {
  return <section className="assessment-unavailable" aria-labelledby="assessment-unavailable-title">
    <div><h2 id="assessment-unavailable-title">Assessment register unavailable</h2><p>We could not verify assessment progress and control review links. No records have been treated as missing.</p></div>
    <Link className="button secondary" href="/app/assessment">Retry</Link>
  </section>;
}

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { supabase, organisation, membership } = await requireAppContext();
  const assessmentAccess = workspaceAccess(membership.role).section("assessments");
  const { message } = await searchParams;
  const sessionResult = await supabase.from("assessment_sessions")
    .select("id,title,state,revision,updated_at,catalogue_version_id", { count: "exact" })
    .eq("organisation_id", organisation.id)
    .order("updated_at", { ascending: false })
    .limit(ASSESSMENT_DISPLAY_LIMIT);
  const sessionCount = sessionResult.count ?? 0;

  let items: AssessmentRegisterItem[] | null = null;
  if (!sessionResult.error && sessionResult.data !== null && sessionResult.count !== null) {
    if (sessionResult.data.length === 0) items = [];
    else {
      const sessionIds = sessionResult.data.map((session) => session.id);
      const catalogueVersionIds = [...new Set(sessionResult.data.map((session) => session.catalogue_version_id))];
      const [questionResult, responseResult, reviewResult] = await Promise.all([
        supabase.from("catalogue_questions").select("id,catalogue_version_id", { count: "exact" }).in("catalogue_version_id", catalogueVersionIds).limit(RELATED_READ_LIMIT),
        supabase.from("assessment_responses").select("session_id,question_id,answer,evidence_note", { count: "exact" }).eq("organisation_id", organisation.id).in("session_id", sessionIds).limit(RELATED_READ_LIMIT),
        supabase.from("soa_registers").select("id,assessment_session_id,version,updated_at,soa_snapshots!soa_snapshots_register_tenant_fk(id)", { count: "exact" }).eq("organisation_id", organisation.id).in("assessment_session_id", sessionIds).order("updated_at", { ascending: false }).order("version", { ascending: false }).order("id", { ascending: false }).limit(RELATED_READ_LIMIT),
      ]);
      if (isCompleteResult(questionResult) && isCompleteResult(responseResult) && isCompleteResult(reviewResult)) {
        const questionTotals = new Map<string, number>();
        for (const question of questionResult.data) questionTotals.set(question.catalogue_version_id, (questionTotals.get(question.catalogue_version_id) ?? 0) + 1);
        const activeReviewBySession = new Map<string, (typeof reviewResult.data)[number]>();
        for (const review of reviewResult.data) {
          if (review.soa_snapshots.length === 0 && !activeReviewBySession.has(review.assessment_session_id)) activeReviewBySession.set(review.assessment_session_id, review);
        }
        items = sessionResult.data.map((session) => {
          const responses = responseResult.data.filter((response) => response.session_id === session.id && response.answer !== null);
          const review = activeReviewBySession.get(session.id);
          return {
            id: session.id, title: session.title, state: session.state, revision: session.revision, updatedAt: session.updated_at,
            answered: responses.length, questions: questionTotals.get(session.catalogue_version_id) ?? 0,
            missingEvidenceNotes: responses.filter((response) => response.evidence_note.trim().length === 0).length,
            activeReviewId: review?.id ?? null, activeReviewVersion: review?.version ?? null,
          };
        });
      }
    }
  }

  return <>
    <PageIntro eyebrow="ASSESSMENT" title="Readiness assessments" body="Record current practice and supporting notes, then carry that source context into a separate control review." action={<span className="assessment-page-actions">
      <a className="button secondary" href="/api/app/assessment/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/assessment/export?format=csv">CSV</a>
      {assessmentAccess.canManage && <form action={createAssessmentAction}><button className="button primary">New assessment</button></form>}
    </span>} />
    {message && <div className="assessment-notice" role="status">{message}</div>}
    <details className="section-guide"><summary>How assessments work</summary><ModuleExplainer guidance={getModuleGuidance("assessment")} /></details>
    {items === null ? <RegisterUnavailable /> : items.length ? <>
      <div className="assessment-register-heading"><div><span>Assessment register</span><strong>{sessionCount} total</strong></div>{sessionCount > items.length && <p>Showing {items.length} of {sessionCount} assessments</p>}</div>
      <section className="assessment-register" aria-label="Readiness assessments">
        {items.map((item) => {
          const unanswered = Math.max(0, item.questions - item.answered);
          const isMember = !assessmentAccess.canManage;
          const action = item.activeReviewId
            ? { href: `/app/soa/${item.activeReviewId}`, label: isMember ? "View control review" : "Resume control review" }
            : { href: `/app/assessment/${item.id}`, label: isMember ? "View assessment" : item.state === "completed" ? "Review controls" : "Continue assessment" };
          return <article className="assessment-register-item" aria-label={`${item.title} assessment`} key={item.id}>
            <div className="assessment-register-main">
              <div className="assessment-register-title"><div><span className="assessment-register-kicker">Gap assessment</span><h2><Link href={`/app/assessment/${item.id}`}>{item.title}</Link></h2></div><Pill tone={item.state === "completed" ? "green" : "amber"}>{item.state === "completed" ? "Completed" : "In progress"}</Pill></div>
              <div className="assessment-register-progress"><div><strong>{item.answered} of {item.questions} answered</strong><span>{unanswered} unanswered</span></div><progress value={item.answered} max={Math.max(1, item.questions)} aria-label={`${item.title} question progress`} /></div>
              <p className={item.missingEvidenceNotes ? "assessment-note-gap" : "assessment-note-gap assessment-note-gap--clear"}>{item.missingEvidenceNotes === 0 ? "Every answered question has a supporting note" : `${item.missingEvidenceNotes} ${item.missingEvidenceNotes === 1 ? "answer lacks" : "answers lack"} a supporting note`}</p>
              <p className="assessment-register-meta">Revision {item.revision} · Updated <time dateTime={item.updatedAt}>{formatUpdatedAt(item.updatedAt)}</time>{item.activeReviewVersion ? ` · Control review v${item.activeReviewVersion}` : ""}</p>
            </div>
            <div className="assessment-register-next"><span>Next step</span><Link className="button primary" href={action.href}>{action.label}</Link></div>
          </article>;
        })}
      </section>
    </> : !assessmentAccess.canManage ? <section className="assessment-empty-card"><h2>No assessments are available yet</h2><p>A workspace operator will need to start one before you can review the answers and supporting notes.</p></section> : (
      <EmptyState icon="clipboard" title="Start your first assessment" body="Answer the plain-English readiness catalogue to see where you stand, capture supporting notes as you go, and identify gaps for later review." action={<form action={createAssessmentAction}><button className="button primary">Start your first assessment</button></form>} />
    )}
  </>;
}
