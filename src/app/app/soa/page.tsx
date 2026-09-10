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

  return <>
    <PageIntro eyebrow="CONTROLS" title="Controls & applicability" body="Review which security controls apply, record your decisions and evidence, then preserve a finalised Statement of Applicability." action={<span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <a className="button secondary" href="/api/app/soa/export?format=xlsx" download>Export XLSX</a>
      <a className="button secondary" href="/api/app/soa/export?format=csv" download>CSV</a>
      {membership.role !== "member" && <Link className="button secondary" href="/app/soa/import">Import</Link>}
    </span>} />
    <SubTabs tabs={[{ href: "/app/soa", label: "Controls & applicability" }, { href: "/app/frameworks", label: "Framework coverage" }]} />
    <details className="section-guide"><summary>How to use the SoA</summary><ModuleExplainer guidance={getModuleGuidance("soa")} /></details>
    {!complete ? <Card style={{ padding: "18px" }}>
      <h2>Control reviews unavailable</h2>
      <p>We could not verify the complete review list and finalised statements. No records have been treated as missing.</p>
      <Link className="button secondary" href="/app/soa">Retry</Link>
    </Card> : <>
      {membership.role === "member" ? <Card style={{ padding: "18px" }}><b>Review access only</b><p>You can open control reviews and download finalised statements. A workspace operator must start a review or create its next version.</p></Card> : assessments.length ? (
        <Card style={{ padding: "16px" }}>
          <form action={createSoaAction} style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
            <label htmlFor="soa-assessment">Source assessment</label>
            <select id="soa-assessment" name="assessmentId" required className="field" style={{ flex: "1 1 200px", minWidth: 0, maxWidth: "100%" }}>
              <option value="">Select an assessment</option>
              {assessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title}</option>)}
            </select>
            <button className="button primary">Start control review</button>
          </form>
          <p style={{ color: "#596273", fontSize: "13px" }}>If this assessment already has an active review, you will continue that review.</p>
        </Card>
      ) : <EmptyState icon="clipboard" title="Start with an assessment" body="Create an assessment, then use it to start a control review. The assessment provides context. You still need to review which controls apply and record your reasons." primary={{ href: "/app/assessment", label: "Start an assessment" }} />}
      <h2 style={{ fontSize: "16px", margin: "24px 0 12px" }}>Active control reviews</h2>
      <Card>{activeReviews.length ? activeReviews.map((review) => <article key={review.id} style={{ padding: "14px 18px", borderTop: "1px solid #edf0f4" }}>
        <h3 style={{ fontSize: "15px", margin: "0 0 8px" }}>{review.title}</h3>
        <p style={{ margin: "0 0 10px" }}>Version {review.version} · {assessments.find((assessment) => assessment.id === review.assessment_session_id)?.title ?? "Source assessment unavailable"}
          {recommendedByAssessment.get(review.assessment_session_id) === review.id && <> · <strong>Recommended</strong></>}
        </p>
        <Link className="button secondary" href={`/app/soa/${review.id}`}>Continue active review</Link>
      </article>) : <p style={{ padding: "18px", color: "#596273" }}>No active control reviews yet.</p>}</Card>
      <p style={{ color: "#596273", fontSize: "13px" }}>When an assessment has several active reviews, the most recently updated is recommended. Ties use the higher version. Every existing review remains available.</p>
      <h2 style={{ fontSize: "16px", margin: "24px 0 12px" }}>Finalised statements</h2>
      <Card>{snapshots.length ? snapshots.map((snapshot) => <article key={snapshot.id} style={{ padding: "14px 18px", borderTop: "1px solid #edf0f4" }}>
        <h3 style={{ fontSize: "15px", margin: "0 0 8px" }}>{snapshot.title} · Version {snapshot.version}</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
          <Link className="button secondary" href={`/app/soa/${snapshot.soa_register_id}`}>Review finalised statement</Link>
          <a href={`/api/app/soa/${snapshot.id}/pdf`}>Download PDF</a>
          <a href={`/api/app/soa/${snapshot.id}/docx`}>Download DOCX</a>
          {membership.role !== "member" && <form action={createSoaSuccessorAction}>
            <input type="hidden" name="registerId" value={snapshot.soa_register_id} />
            <button className="button secondary">Create next version</button>
          </form>}
        </div>
      </article>) : <p style={{ padding: "18px", color: "#596273" }}>No finalised statements yet. Finalise a reviewed control review when its decisions and evidence references are ready.</p>}</Card>
    </>}
  </>;
}
