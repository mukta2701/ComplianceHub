import Link from "next/link";
import { PageIntro } from "@/components/ui";
import { loadControlReview, type ControlReviewLoadResult } from "@/features/soa/application/load-control-review";
import { SOA_CATALOGUE_SIZE } from "@/features/soa/application/finalisation";
import { summariseSoaQueue } from "@/features/soa/application/review-queue";
import { requireAppContext } from "@/lib/app-context";
import { finaliseSoaAction, reviewSoaItemAction } from "../../actions";
import { SoaReviewWorkspace } from "./soa-review-workspace";

function CatalogueContext({ catalogues }: { catalogues: ControlReviewLoadResult["catalogues"] }) {
  if (!catalogues) return null;
  return <div className="soa-catalogue-provenance" aria-label="Catalogue provenance">
    {(["assessment", "control"] as const).map((kind) => {
      const catalogue = catalogues[kind];
      return <p key={kind}>{kind === "assessment" ? "Assessment" : "Control"} catalogue: {catalogue.title ? `${catalogue.title} — ` : ""}{catalogue.version ? `version ${catalogue.version}; ` : ""}ID: {catalogue.id}</p>;
    })}
  </div>;
}

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

  if (review.finalisedStatement) {
    const statement = review.finalisedStatement;
    return <>
      <PageIntro eyebrow={`STATEMENT OF APPLICABILITY - V${register.version}`} title={register.title}
        body={`${statement.organisationName} · Finalised ${statement.finalisedAt}. These saved decisions are immutable.`}
        action={<Link className="button secondary" href="/app/soa">Controls & applicability</Link>} />
      <section className="panel" aria-label="Saved statement provenance">
        <h2>Saved statement provenance</h2>
        <p>Source assessment ID: {register.sourceAssessment.id}</p>
        <CatalogueContext catalogues={review.catalogues} />
        <p><Link href={`/app/assessment/${register.sourceAssessment.id}`}>Open current source assessment</Link>. Its current answers, state and revision are not part of this saved statement.</p>
        <p>Current owners, linked work and evidence freshness are not re-evaluated here. The evidence notes below are the notes saved at finalisation.</p>
        {membership.role !== "member" && <p><a href={`/api/app/soa/${statement.id}/pdf`}>Download saved PDF</a> · <a href={`/api/app/soa/${statement.id}/docx`}>Download saved DOCX</a></p>}
      </section>
      {review.optionalUnavailable.length > 0 && <p role="status">Unavailable labels: {review.optionalUnavailable.join(", ")}. Saved identities and decisions remain available.</p>}
      <section aria-label="Saved control decisions">
        <h2>{statement.items.length} saved control decisions</h2>
        {statement.items.map((item, index) => <article className="panel" key={`${item.controlCode}-${index}`}>
          <h3>{item.controlCode}: {item.controlTitle}</h3>
          <p>{item.applicable ? "Applicable" : "Not applicable"} · Recorded status: {item.status.replaceAll("_", " ")}</p>
          <p>{item.ownerId ? "An owner was recorded at finalisation." : item.ownerId === null ? "No owner was recorded at finalisation." : "This older statement does not include an owner record."}</p>
          <h4>Saved rationale</h4><p>{item.justification || "No rationale recorded."}</p>
          <h4>Saved evidence note</h4><p>{item.evidence || "No evidence note recorded."}</p>
        </article>)}
      </section>
    </>;
  }

  const summary = summariseSoaQueue(review.items);
  const canFinalise = finalisation.readiness === "ready";
  const blockers = finalisation.blockers;
  const preflight = canFinalise
    ? `Finalisation checks passed for all ${summary.total} controls. Date-based evidence freshness remains separate review guidance.`
    : [
      blockers.incompleteCatalogue ? `The review must contain all ${SOA_CATALOGUE_SIZE} controls; ${summary.total} are present.` : null,
      `${blockers.pending.length} pending, ${blockers.missingRationale.length} missing rationale, ${blockers.unassigned.length} unassigned, ${blockers.missingEvidence.length} missing live evidence, ${blockers.expiredEvidence.length} with stored expired evidence.`,
    ].filter(Boolean).join(" ");
  const source = register.sourceAssessment;

  return <>
    <PageIntro
      eyebrow={`CONTROL REVIEW - V${register.version}`}
      title={register.title}
      body={`Work through the ${SOA_CATALOGUE_SIZE} ISO controls and record applicability, progress, ownership, rationale and evidence. Decisions remain editable until you create the formal statement.`}
      action={canFinalise && membership.role !== "member" ? (
        <form action={finaliseSoaAction} data-soa-finalise-form>
          <input type="hidden" name="registerId" value={id} />
          <button className="button primary">Finalise immutable v{register.version}</button>
        </form>
      ) : <Link className="button secondary" href="/app/soa">Controls & applicability</Link>}
    />
    <section className="soa-review-header" aria-label="Control review context">
      <div><span className="eyebrow">SOURCE ASSESSMENT</span><strong><Link href={`/app/assessment/${source.id}`}>{source.title}</Link></strong><small>Revision {source.revision} · {source.state}</small></div>
      <div><span className="eyebrow">REVIEW STATE</span><strong>Active and editable</strong><small>Version {register.version}</small></div>
      <div><span className="eyebrow">LAST ACTIVITY</span><strong><time dateTime={register.updatedAt}>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(register.updatedAt))}</time></strong><small>Register activity</small></div>
      <div><span className="eyebrow">FORMAL OUTPUT</span><strong>Not finalised</strong><small>Finalisation creates an immutable Statement of Applicability.</small></div>
    </section>
    <section className={`soa-finalisation-status ${canFinalise ? "is-ready" : "is-blocked"}`} aria-label="Finalisation readiness">
      <div><span className="eyebrow">FINALISATION CHECK</span><h2>{canFinalise ? "Ready to create the formal statement" : "Work remains before finalisation"}</h2><p>{preflight}</p></div>
      {!canFinalise && <Link href="#soa-review-blockers">Review attention filters</Link>}
    </section>
    <details className="soa-provenance-details"><summary>Catalogue and source details</summary><CatalogueContext catalogues={review.catalogues} /><p>Current assessment context — {source.state}, revision {source.revision}. Answers can change after a control decision is saved.</p></details>
    {source.state !== "completed" && <p className="soa-context-warning">This assessment is incomplete. Its recorded answers provide context; they do not decide applicability or establish effectiveness.</p>}
    {review.optionalUnavailable.length > 0 && <p role="status">Unavailable context: {review.optionalUnavailable.join(", ")}. The remaining review is available.</p>}
    {review.relatedRisks.length > 0 && <section className="panel" aria-label="Related risks">
      <h2>Related risks</h2>
      <p>These links describe the assessment or register as a whole.</p>
      <ul>{review.relatedRisks.map((risk) => <li key={`${risk.relationship}-${risk.id}`}>{membership.role === "member" ? <span>{risk.reference}: {risk.title}</span> : <Link href={`/app/risks/${risk.id}`}>{risk.reference}: {risk.title}</Link>} — {risk.relationship === "assessment" ? "Assessment" : "Register"} context, {risk.status}</li>)}</ul>
      {(["assessment", "register"] as const).map((relationship) => {
        const list = review.riskLists[relationship];
        return list.truncated ? <p key={relationship}>Showing {list.shown} of {list.total} {relationship}-related risks (limit {list.limit}).</p> : null;
      })}
    </section>}
    <SoaReviewWorkspace
      aiEnabled={review.aiEnabled}
      readOnly={membership.role === "member"}
      items={review.items}
      members={review.members}
      currentUserId={user.id}
      registerId={id}
      saveAction={reviewSoaItemAction}
      sourceAssessment={source}
    />
  </>;
}
