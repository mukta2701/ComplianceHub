import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, ModuleExplainer, PageIntro } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { getModuleGuidance } from "@/features/education/domain/guidance";
import { createSoaAction, createSoaSuccessorAction } from "../actions";

const REVIEW_READ_LIMIT = 5_000;

function isCompleteResult<T>(result: { data: T[] | null; error: unknown; count: number | null }): result is { data: T[]; error: null; count: number } {
  return !result.error && result.data !== null && result.count !== null && result.count === result.data.length;
}

function formatActivity(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export default async function SoaPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const [assessmentResult, registerResult, snapshotResult] = await Promise.all([
    supabase.from("assessment_sessions").select("id,title", { count: "exact" }).eq("organisation_id", organisation.id).order("updated_at", { ascending: false }).limit(REVIEW_READ_LIMIT),
    supabase.from("soa_registers").select("id,title,assessment_session_id,version,updated_at", { count: "exact" }).eq("organisation_id", organisation.id).order("updated_at", { ascending: false }).order("version", { ascending: false }).order("id", { ascending: false }).limit(REVIEW_READ_LIMIT),
    supabase.from("soa_snapshots").select("id,soa_register_id,title,version,finalised_at", { count: "exact" }).eq("organisation_id", organisation.id).order("finalised_at", { ascending: false }).limit(REVIEW_READ_LIMIT),
  ]);
  const complete = isCompleteResult(assessmentResult) && isCompleteResult(registerResult) && isCompleteResult(snapshotResult);
  const assessments = complete ? assessmentResult.data! : [];
  const registers = complete ? registerResult.data! : [];
  const snapshots = complete ? snapshotResult.data! : [];
  const finalisedIds = new Set(snapshots.map((snapshot) => snapshot.soa_register_id));
  const activeReviews = registers.filter((register) => !finalisedIds.has(register.id));
  const recommendedByAssessment = new Map<string, string>();
  for (const review of activeReviews) {
    if (!recommendedByAssessment.has(review.assessment_session_id)) recommendedByAssessment.set(review.assessment_session_id, review.id);
  }
  const reviewRecordTotal = activeReviews.length + snapshots.length;

  return <div className="soa-landing">
    <PageIntro
      eyebrow="CONTROLS"
      title="Controls & applicability"
      body="Use current assessment context to make accountable control decisions, then preserve an immutable Statement of Applicability."
      action={<span className="soa-page-actions">
        <a className="button secondary" href="/api/app/soa/export?format=xlsx" download>Export XLSX</a>
        <a className="button secondary" href="/api/app/soa/export?format=csv" download>CSV</a>
        {membership.role !== "member" && <Link className="button secondary" href="/app/soa/import">Import</Link>}
      </span>}
    />
    <SubTabs tabs={[{ href: "/app/soa", label: "Controls & applicability" }, { href: "/app/frameworks", label: "Framework coverage" }]} />
    <nav className="soa-programme-steps" aria-label="Programme steps">
      <Link href="/app/assessment"><span>1</span><small>Assessment</small><strong>Assess current practices</strong></Link>
      <a href="#active-control-reviews" aria-current="step"><span>2</span><small>Control review</small><strong>Review control decisions</strong></a>
      <a href="#finalised-statements"><span>3</span><small>Formal output</small><strong>Finalise formal statement</strong></a>
    </nav>
    <details className="section-guide"><summary>How controls and applicability work</summary><ModuleExplainer guidance={getModuleGuidance("soa")} /></details>

    {!complete ? <Card className="soa-unavailable-panel" role="alert">
      <h2>Control reviews unavailable</h2>
      <p>We could not verify the complete review list and finalised statements. No records have been treated as missing.</p>
      <Link className="button secondary" href="/app/soa">Retry</Link>
    </Card> : <>
      <section className="soa-landing-overview" aria-label="Control review overview">
        <Card className="soa-lifecycle-summary">
          <div><span className="eyebrow">PROGRAMME OUTPUT</span><strong>{snapshots.length} finalised</strong><p>{activeReviews.length} active control review{activeReviews.length === 1 ? "" : "s"} remain editable.</p></div>
          <progress max={Math.max(reviewRecordTotal, 1)} value={snapshots.length} aria-label={`${snapshots.length} of ${reviewRecordTotal} review records are finalised statements`} aria-valuemin={0} aria-valuemax={Math.max(reviewRecordTotal, 1)} aria-valuenow={snapshots.length} aria-valuetext={`${snapshots.length} finalised statements; ${activeReviews.length} active reviews`} />
          <small>This shows record state, not certification or control effectiveness.</small>
        </Card>

        {membership.role === "member" ? <Card className="soa-start-panel">
          <span className="eyebrow">READ-ONLY ACCESS</span><h2>Review the programme record</h2><p>You can open control reviews and download finalised statements. A workspace operator must start a review or create its next version.</p>
        </Card> : assessments.length ? <Card className="soa-start-panel">
          <span className="eyebrow">NEXT ACTION</span><h2>Start or resume a control review</h2><p>The selected assessment provides current context. A reviewer still makes every control decision.</p>
          <form action={createSoaAction}>
            <label htmlFor="soa-assessment">Source assessment</label>
            <select id="soa-assessment" name="assessmentId" required className="field"><option value="">Select an assessment</option>{assessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title}</option>)}</select>
            <button className="button primary">Start control review</button>
          </form>
          <small>If the assessment already has an active review, this action safely continues it.</small>
        </Card> : <EmptyState icon="clipboard" title="Start with an assessment" body="Create an assessment, then use it to start a control review. The assessment provides context. You still need to review which controls apply and record your reasons." primary={{ href: "/app/assessment", label: "Start an assessment" }} />}
      </section>

      <section className="soa-landing-section" id="active-control-reviews" aria-labelledby="active-control-heading">
        <header className="soa-section-heading"><div><span className="eyebrow">WORKING REGISTER</span><h2 id="active-control-heading">Active control reviews</h2><p>Editable working decisions</p></div><strong>{activeReviews.length}</strong></header>
        <Card className="soa-record-list">{activeReviews.length ? activeReviews.map((review) => {
          const sourceAssessment = assessments.find((assessment) => assessment.id === review.assessment_session_id);
          const recommended = recommendedByAssessment.get(review.assessment_session_id) === review.id;
          return <article key={review.id}>
            <div className="soa-record-title"><div><small>CONTROL REVIEW · VERSION {review.version}</small><h3>{review.title}</h3></div>{recommended && <span className="pill">Recommended</span>}</div>
            <dl><div><dt>Source</dt><dd>{sourceAssessment ? <Link href={`/app/assessment/${sourceAssessment.id}`}>{sourceAssessment.title}</Link> : "Source assessment unavailable"}</dd></div><div><dt>Last activity</dt><dd><time dateTime={review.updated_at}>{formatActivity(review.updated_at)}</time></dd></div><div><dt>State</dt><dd>Active and editable</dd></div></dl>
            <Link className={`button ${recommended ? "primary" : "secondary"}`} href={`/app/soa/${review.id}`}>Continue active review</Link>
          </article>;
        }) : <p className="soa-list-empty">No active control reviews yet.</p>}</Card>
        {activeReviews.length > 1 && <p className="soa-list-note">When an assessment has several active reviews, the latest activity is recommended. Ties use the higher version. Every existing review remains available.</p>}
      </section>

      <section className="soa-landing-section" id="finalised-statements" aria-labelledby="finalised-heading">
        <header className="soa-section-heading"><div><span className="eyebrow">SAVED RECORD</span><h2 id="finalised-heading">Finalised statements</h2><p>Immutable formal outputs</p></div><strong>{snapshots.length}</strong></header>
        <Card className="soa-record-list soa-formal-list">{snapshots.length ? snapshots.map((snapshot) => <article key={snapshot.id}>
          <div className="soa-record-title"><div><small>STATEMENT OF APPLICABILITY · VERSION {snapshot.version}</small><h3>{snapshot.title}</h3></div><span className="pill green">Finalised</span></div>
          <dl><div><dt>Finalised</dt><dd><time dateTime={snapshot.finalised_at}>{formatActivity(snapshot.finalised_at)}</time></dd></div><div><dt>State</dt><dd>Saved and immutable</dd></div></dl>
          <div className="soa-record-actions"><Link className="button secondary" href={`/app/soa/${snapshot.soa_register_id}`}>Review finalised statement</Link><a href={`/api/app/soa/${snapshot.id}/pdf`}>Download PDF</a><a href={`/api/app/soa/${snapshot.id}/docx`}>Download DOCX</a>{membership.role !== "member" && <form action={createSoaSuccessorAction}><input type="hidden" name="registerId" value={snapshot.soa_register_id} /><button className="button secondary">Create next version</button></form>}</div>
        </article>) : <p className="soa-list-empty">No finalised statements yet. Finalise a reviewed control review when its decisions and evidence references are ready.</p>}</Card>
      </section>
    </>}
  </div>;
}
