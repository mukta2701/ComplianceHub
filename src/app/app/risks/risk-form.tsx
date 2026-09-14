"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import { createRiskFormAction, updateRiskFormAction, type RiskFormState } from "./edit-actions";
import styles from "./risk-form.module.css";

export type RiskFormValues = {
  reference: string;
  title: string;
  description: string;
  categoryId: string;
  ownerId: string;
  reviewDate: string;
  likelihood: string;
  impact: string;
  residualLikelihood: string;
  residualImpact: string;
  treatment: string;
  status: string;
  treatmentPlan: string;
  evidence: string;
  sourceAssessmentSessionId: string;
};

type Option = { id: string; label: string };

export function RiskForm({ mode, values, options, cancelHref, riskId, expectedUpdatedAt }: {
  mode: "create" | "edit";
  values: RiskFormValues;
  options: { categories: Option[]; owners: Option[] };
  cancelHref: string;
  riskId?: string;
  expectedUpdatedAt?: string;
}) {
  const [draft, setDraft] = useState(values);
  const [editContext] = useState(() => ({ riskId, expectedUpdatedAt }));
  const serverAction = mode === "create" ? createRiskFormAction : updateRiskFormAction;
  const [state, action, pending] = useActionState<RiskFormState, FormData>(async (previous, formData) => {
    try {
      return await serverAction(previous, formData);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "Could not confirm whether the risk was saved. Your entries are still shown. Copy them before refreshing and check the register before trying again." };
    }
  }, {});

  function update(field: keyof RiskFormValues, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  function fieldError(field: keyof RiskFormValues) {
    return state.fieldErrors?.[field]?.[0];
  }
  function describedBy(field: keyof RiskFormValues, helpId?: string) {
    return [helpId, fieldError(field) ? `risk-${field}-error` : null].filter(Boolean).join(" ") || undefined;
  }

  return <form action={action} aria-busy={pending} className={styles.form}>
    {editContext.riskId && <input type="hidden" name="id" value={editContext.riskId} />}
    {editContext.expectedUpdatedAt && <input type="hidden" name="expectedUpdatedAt" value={editContext.expectedUpdatedAt} />}
    {mode === "create" && draft.sourceAssessmentSessionId && <input type="hidden" name="sourceAssessmentSessionId" value={draft.sourceAssessmentSessionId} />}

    <fieldset className={styles.section}>
      <legend>Risk context</legend>
      <p className={styles.sectionHelp}>Describe the exposure clearly enough for another person to understand what may happen and why it matters.</p>
      <div className={styles.twoColumns}>
        <Field label="Reference" required error={fieldError("reference")} id="risk-reference">
          <input id="risk-reference" name="reference" required maxLength={40} value={draft.reference} aria-invalid={Boolean(fieldError("reference"))} aria-describedby={describedBy("reference")} onChange={(event) => update("reference", event.target.value)} />
        </Field>
        <Field label="Title" required error={fieldError("title")} id="risk-title">
          <input id="risk-title" name="title" required maxLength={200} value={draft.title} aria-invalid={Boolean(fieldError("title"))} aria-describedby={describedBy("title")} onChange={(event) => update("title", event.target.value)} />
        </Field>
      </div>
      <Field label="Description" required error={fieldError("description")} id="risk-description" help="State the scenario, the affected service or information, and the likely business consequence.">
        <textarea id="risk-description" name="description" rows={5} required maxLength={10000} value={draft.description} aria-invalid={Boolean(fieldError("description"))} aria-describedby={describedBy("description", "risk-description-help")} onChange={(event) => update("description", event.target.value)} />
      </Field>
      <div className={styles.threeColumns}>
        <Field label="Category" required error={fieldError("categoryId")} id="risk-categoryId">
          <select id="risk-categoryId" name="categoryId" required value={draft.categoryId} aria-invalid={Boolean(fieldError("categoryId"))} aria-describedby={describedBy("categoryId")} onChange={(event) => update("categoryId", event.target.value)}><option value="" disabled>Select a category</option>{options.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </Field>
        <Field label="Owner" id="risk-ownerId">
          <select id="risk-ownerId" name="ownerId" value={draft.ownerId} onChange={(event) => update("ownerId", event.target.value)}><option value="">Unassigned</option>{options.owners.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </Field>
        <Field label="Review date" id="risk-reviewDate" error={fieldError("reviewDate")}>
          <input id="risk-reviewDate" name="reviewDate" type="date" value={draft.reviewDate} aria-invalid={Boolean(fieldError("reviewDate"))} aria-describedby={describedBy("reviewDate")} onChange={(event) => update("reviewDate", event.target.value)} />
        </Field>
      </div>
    </fieldset>

    <fieldset className={styles.section}>
      <legend>Exposure scoring</legend>
      <p className={styles.sectionHelp}>Score likelihood and impact from 1 (lowest) to 5 (highest). Residual exposure is what remains after treatment.</p>
      <div className={styles.scoreGrid}>
        <ScorePair title="Inherent exposure" description="Before safeguards" likelihoodName="likelihood" impactName="impact" draft={draft} update={update} fieldError={fieldError} />
        <div className={styles.scoreArrow} aria-hidden="true">→</div>
        <ScorePair title="Residual exposure" description="After safeguards" likelihoodName="residualLikelihood" impactName="residualImpact" draft={draft} update={update} fieldError={fieldError} />
      </div>
      <p className={styles.scoreNote}>These scores record a risk judgement. They do not prove that safeguards are effective.</p>
    </fieldset>

    <fieldset className={styles.section}>
      <legend>Treatment and review</legend>
      <p className={styles.sectionHelp}>Record the chosen response and what will reduce or govern the remaining exposure.</p>
      <div className={styles.twoColumns}>
        <Field label="Treatment" required id="risk-treatment">
          <select id="risk-treatment" name="treatment" value={draft.treatment} onChange={(event) => update("treatment", event.target.value)}><option value="mitigate">Mitigate</option><option value="avoid">Avoid</option><option value="transfer">Transfer</option><option value="accept">Accept</option></select>
        </Field>
        <Field label="Status" required id="risk-status">
          <select id="risk-status" name="status" value={draft.status} onChange={(event) => update("status", event.target.value)}><option value="open">Open</option><option value="treating">Treating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select>
        </Field>
      </div>
      <Field label="Treatment approach" id="risk-treatmentPlan" error={fieldError("treatmentPlan")} help="Describe the overall approach here. Track separate deliverables as treatment plans on the risk detail page.">
        <textarea id="risk-treatmentPlan" name="treatmentPlan" maxLength={10000} value={draft.treatmentPlan} aria-invalid={Boolean(fieldError("treatmentPlan"))} aria-describedby={describedBy("treatmentPlan", "risk-treatmentPlan-help")} onChange={(event) => update("treatmentPlan", event.target.value)} />
      </Field>
      <Field label="Evidence references" id="risk-evidence" error={fieldError("evidence")} help="Use this for supporting notes or external references. Add managed evidence records separately so freshness and review status remain visible.">
        <textarea id="risk-evidence" name="evidence" maxLength={10000} value={draft.evidence} aria-invalid={Boolean(fieldError("evidence"))} aria-describedby={describedBy("evidence", "risk-evidence-help")} onChange={(event) => update("evidence", event.target.value)} />
      </Field>
      <p className={styles.statusNote}>Accepted and closed are operator-recorded statuses. They do not establish certification, provider verification or independent approval.</p>
    </fieldset>

    <div className={styles.actions}>
      <p>Only workspace operators can {mode === "create" ? "create" : "edit"} risks.</p>
      <div><Link className="button secondary" href={cancelHref}>Cancel</Link><button className="button primary" disabled={pending}>{pending ? "Saving…" : mode === "create" ? "Create risk" : "Save risk"}</button></div>
    </div>
    {!pending && state.error && <p className={state.conflict ? styles.conflict : styles.error} role="alert">{state.error}</p>}
  </form>;
}

function Field({ label, required, error, id, help, children }: { label: string; required?: boolean; error?: string; id: string; help?: string; children: ReactNode }) {
  return <div className={styles.field}>
    <div className={styles.fieldLabel}><label htmlFor={id}>{label}</label><span aria-hidden="true" className={required ? styles.required : styles.optional}>{required ? "Required" : "Optional"}</span></div>
    {children}
    {help && <small id={`${id}-help`}>{help}</small>}
    {error && <small id={`${id}-error`} className={styles.fieldError}>{error}</small>}
  </div>;
}

function ScorePair({ title, description, likelihoodName, impactName, draft, update, fieldError }: {
  title: string; description: string; likelihoodName: "likelihood" | "residualLikelihood"; impactName: "impact" | "residualImpact";
  draft: RiskFormValues; update: (field: keyof RiskFormValues, value: string) => void; fieldError: (field: keyof RiskFormValues) => string | undefined;
}) {
  const likelihoodLabel = likelihoodName === "likelihood" ? "Likelihood" : "Residual likelihood";
  const impactLabel = impactName === "impact" ? "Impact" : "Residual impact";
  return <section className={styles.scoreCard} aria-label={title}>
    <div className={styles.scoreHeading}><div><strong>{title}</strong><small>{description}</small></div><output aria-label={`${title} score`}>{Number(draft[likelihoodName]) * Number(draft[impactName])}</output></div>
    <div className={styles.twoColumns}>
      <Field label={likelihoodLabel} required id={`risk-${likelihoodName}`} error={fieldError(likelihoodName)}><select id={`risk-${likelihoodName}`} name={likelihoodName} value={draft[likelihoodName]} onChange={(event) => update(likelihoodName, event.target.value)}>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}</select></Field>
      <Field label={impactLabel} required id={`risk-${impactName}`} error={fieldError(impactName)}><select id={`risk-${impactName}`} name={impactName} value={draft[impactName]} onChange={(event) => update(impactName, event.target.value)}>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}</select></Field>
    </div>
  </section>;
}
