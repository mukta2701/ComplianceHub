import type { ReactNode } from "react";
import styles from "../risks/risk-form.module.css";
export type PolicyDraft = { reference: string; title: string; body: string; ownerId: string; reviewDue: string };
export type PolicyOwnerOption = { id: string; name: string };
export function PolicyFields({ draft, owners, errors, change }: { draft: PolicyDraft; owners: PolicyOwnerOption[]; errors?: Record<string, string[] | undefined>; change: (field: keyof PolicyDraft, value: string) => void }) {
  const error = (field: keyof PolicyDraft) => errors?.[field]?.[0];
  return <>
    <fieldset className={styles.section}><legend>Identity and accountability</legend>
      <p className={styles.sectionHelp}>Give the policy a clear name and identify the person responsible for keeping it useful.</p>
      <div className={styles.twoColumns}>
        <Field id="policy-reference" label="Reference" required error={error("reference")}><input id="policy-reference" name="reference" required maxLength={40} value={draft.reference} aria-invalid={Boolean(error("reference"))} aria-describedby={error("reference") ? "policy-reference-error" : undefined} onChange={(e) => change("reference", e.target.value)} /></Field>
        <Field id="policy-title" label="Title" required error={error("title")}><input id="policy-title" name="title" required maxLength={200} value={draft.title} aria-invalid={Boolean(error("title"))} aria-describedby={error("title") ? "policy-title-error" : undefined} onChange={(e) => change("title", e.target.value)} /></Field>
      </div>
      <div className={styles.twoColumns}>
        <Field id="policy-ownerId" label="Policy owner" error={error("ownerId")}><select id="policy-ownerId" name="ownerId" value={draft.ownerId} aria-invalid={Boolean(error("ownerId"))} aria-describedby={error("ownerId") ? "policy-ownerId-error" : undefined} onChange={(e) => change("ownerId", e.target.value)}><option value="">Unassigned</option>{draft.ownerId && !owners.some((owner) => owner.id === draft.ownerId) && <option value={draft.ownerId}>Current owner (not in member list)</option>}{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></Field>
        <Field id="policy-reviewDue" label="Review due" error={error("reviewDue")}><input id="policy-reviewDue" name="reviewDue" type="date" value={draft.reviewDue} aria-invalid={Boolean(error("reviewDue"))} aria-describedby={error("reviewDue") ? "policy-reviewDue-error" : undefined} onChange={(e) => change("reviewDue", e.target.value)} /></Field>
      </div>
    </fieldset>
    <fieldset className={styles.section}><legend>Document</legend><p className={styles.sectionHelp}>Describe the scope, responsibilities and practices people should follow. Templates are starting points for your review.</p>
      <Field id="policy-body" label="Policy content" error={error("body")}><textarea id="policy-body" name="body" maxLength={100000} rows={14} value={draft.body} aria-invalid={Boolean(error("body"))} aria-describedby={error("body") ? "policy-body-error" : undefined} onChange={(e) => change("body", e.target.value)} /></Field>
    </fieldset>
  </>;
}

function Field({ id, label, required, error, children }: { id: string; label: string; required?: boolean; error?: string; children: ReactNode }) {
  return <div className={styles.field}><div className={styles.fieldLabel}><label htmlFor={id}>{label}</label><span aria-hidden="true" className={required ? styles.required : styles.optional}>{required ? "Required" : "Optional"}</span></div>{children}{error && <small id={`${id}-error`} className={styles.fieldError}>{error}</small>}</div>;
}
