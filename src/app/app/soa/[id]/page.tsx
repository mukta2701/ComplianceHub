import Link from "next/link";
import { PageIntro } from "@/components/ui";
import { loadControlReview } from "@/features/soa/application/load-control-review";
import { summariseSoaQueue } from "@/features/soa/application/review-queue";
import { requireAppContext } from "@/lib/app-context";
import { finaliseSoaAction, reviewSoaItemAction } from "../../actions";
import { SoaReviewWorkspace } from "./soa-review-workspace";

export default async function SoaReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, organisation, membership } = await requireAppContext();
  const review = await loadControlReview(supabase, { organisationId: organisation.id, registerId: id });
  const { register, finalisation } = review;

  if (!register || finalisation.readiness === "could_not_verify") return <>
    <PageIntro eyebrow="CONTROL REVIEW" title="Controls & applicability" body="Readiness could not be checked." />
    <section className="panel" role="alert">
      <h2>Could not verify</h2>
      <p>Could not verify {finalisation.unavailableInputs.join(", ")}. Finalisation is unavailable until these records can be checked.</p>
      <a className="button secondary" href={`/app/soa/${id}`}>Try again</a>
    </section>
  </>;

  const summary = summariseSoaQueue(review.items);
  const canFinalise = finalisation.readiness === "ready" && !register.finalisedSnapshotId;
  const blockers = finalisation.blockers;
  const preflight = canFinalise
    ? `Finalisation checks passed for all ${summary.total} controls. Date-based evidence freshness remains separate review guidance.`
    : [
      blockers.incompleteCatalogue ? `The review must contain all 93 controls; ${summary.total} are present.` : null,
      `${blockers.pending.length} pending, ${blockers.missingRationale.length} missing rationale, ${blockers.unassigned.length} unassigned, ${blockers.missingEvidence.length} missing live evidence, ${blockers.expiredEvidence.length} with stored expired evidence.`,
    ].filter(Boolean).join(" ");
  const source = register.sourceAssessment;

  return <>
    <PageIntro
      eyebrow={`CONTROL REVIEW - V${register.version}`}
      title={register.title}
      body={register.finalisedSnapshotId ? "This review has a finalised Statement of Applicability. Its saved statement is immutable." : preflight}
      action={canFinalise && membership.role !== "member" ? (
        <form action={finaliseSoaAction} data-soa-finalise-form>
          <input type="hidden" name="registerId" value={id} />
          <button className="button primary">Finalise immutable v{register.version}</button>
        </form>
      ) : <Link className="button secondary" href="/app/soa">Controls & applicability</Link>}
    />
    <section className="panel" aria-label="Source assessment">
      <h2>Source assessment: <Link href={`/app/assessment/${source.id}`}>{source.title}</Link></h2>
      <p>Current assessment context — {source.state}, revision {source.revision}. Answers can change after a control decision is saved.</p>
      {source.state !== "completed" && <p>This assessment is incomplete. Its recorded answers provide context; they do not decide applicability or establish effectiveness.</p>}
      {register.finalisedSnapshotId && <p>The source link opens its current record. Later answers are not part of the immutable statement.</p>}
    </section>
    {review.optionalUnavailable.length > 0 && <p role="status">Unavailable context: {review.optionalUnavailable.join(", ")}. The remaining review is available.</p>}
    {review.relatedRisks.length > 0 && <section className="panel" aria-label="Related risks">
      <h2>Related risks</h2>
      <p>These links describe the assessment or register as a whole.</p>
      <ul>{review.relatedRisks.map((risk) => <li key={`${risk.relationship}-${risk.id}`}><Link href={`/app/risks/${risk.id}`}>{risk.reference}: {risk.title}</Link> — {risk.relationship === "assessment" ? "Assessment" : "Register"} context, {risk.status}</li>)}</ul>
      {(["assessment", "register"] as const).map((relationship) => {
        const list = review.riskLists[relationship];
        return list.truncated ? <p key={relationship}>Showing {list.shown} of {list.total} {relationship}-related risks (limit {list.limit}).</p> : null;
      })}
    </section>}
    <SoaReviewWorkspace
      aiEnabled={review.aiEnabled}
      readOnly={membership.role === "member" || Boolean(register.finalisedSnapshotId)}
      items={review.items}
      members={review.members}
      currentUserId={user.id}
      registerId={id}
      saveAction={reviewSoaItemAction}
    />
  </>;
}
