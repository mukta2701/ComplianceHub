"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import { createAssetFormAction, updateAssetFormAction, type AssetFormState } from "./edit-actions";
import styles from "../risks/risk-form.module.css";

export type AssetFormValues = {
  reference: string;
  description: string;
  ownerLocation: string;
  ownerId: string;
  categoryId: string;
  classification: string;
  valueCriticality: string;
  securityControls: string;
  lifespan: string;
  lastUpdated: string;
  remarks: string;
};

type Option = { id: string; label: string };

export function AssetForm({ mode, values, options, cancelHref, assetId, expectedUpdatedAt }: {
  mode: "create" | "edit";
  values: AssetFormValues;
  options: { categories: Option[]; owners: Option[] };
  cancelHref: string;
  assetId?: string;
  expectedUpdatedAt?: string;
}) {
  const [draft, setDraft] = useState(values);
  const [editContext] = useState(() => ({ assetId, expectedUpdatedAt }));
  const serverAction = mode === "create" ? createAssetFormAction : updateAssetFormAction;
  const [state, action, pending] = useActionState<AssetFormState, FormData>(async (previous, formData) => {
    try {
      return await serverAction(previous, formData);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "Could not confirm whether the asset was saved. Your entries are still shown. Copy them before refreshing and check the inventory before trying again." };
    }
  }, {});

  function update(field: keyof AssetFormValues, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  function fieldError(field: keyof AssetFormValues) {
    return state.fieldErrors?.[field]?.[0];
  }
  function describedBy(field: keyof AssetFormValues, helpId?: string) {
    return [helpId, fieldError(field) ? `asset-${field}-error` : null].filter(Boolean).join(" ") || undefined;
  }

  return <form action={action} aria-busy={pending} className={styles.form}>
    {editContext.assetId && <input type="hidden" name="id" value={editContext.assetId} />}
    {editContext.expectedUpdatedAt && <input type="hidden" name="expectedUpdatedAt" value={editContext.expectedUpdatedAt} />}

    <fieldset className={styles.section}>
      <legend>Asset identity</legend>
      <p className={styles.sectionHelp}>Name the information, system, service or device so another person can recognise it without opening the record.</p>
      <div className={styles.twoColumns}>
        <Field label="Reference" required id="asset-reference" error={fieldError("reference")}>
          <input id="asset-reference" name="reference" required maxLength={40} value={draft.reference} aria-invalid={Boolean(fieldError("reference"))} aria-describedby={describedBy("reference")} onChange={(event) => update("reference", event.target.value)} />
        </Field>
        <Field label="Asset name" required id="asset-description" error={fieldError("description")} help="Use a clear name such as Customer database or Staff laptops.">
          <input id="asset-description" name="description" required maxLength={200} value={draft.description} aria-invalid={Boolean(fieldError("description"))} aria-describedby={describedBy("description", "asset-description-help")} onChange={(event) => update("description", event.target.value)} />
        </Field>
      </div>
      <div className={styles.twoColumns}>
        <Field label="Category" id="asset-categoryId" error={fieldError("categoryId")}>
          <select id="asset-categoryId" name="categoryId" value={draft.categoryId} aria-invalid={Boolean(fieldError("categoryId"))} aria-describedby={describedBy("categoryId")} onChange={(event) => update("categoryId", event.target.value)}><option value="">Uncategorised</option>{options.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </Field>
        <Field label="Owner & location" id="asset-ownerLocation" error={fieldError("ownerLocation")} help="Descriptive text only. It does not assign responsibility.">
          <input id="asset-ownerLocation" name="ownerLocation" maxLength={200} value={draft.ownerLocation} aria-invalid={Boolean(fieldError("ownerLocation"))} aria-describedby={describedBy("ownerLocation", "asset-ownerLocation-help")} onChange={(event) => update("ownerLocation", event.target.value)} />
        </Field>
      </div>
    </fieldset>

    <fieldset className={styles.section}>
      <legend>Accountability and handling</legend>
      <p className={styles.sectionHelp}>Assign responsibility separately from location, then record sensitivity and business importance as independent judgements.</p>
      <div className={styles.threeColumns}>
        <Field label="In-app owner" id="asset-ownerId" error={fieldError("ownerId")}>
          <select id="asset-ownerId" name="ownerId" value={draft.ownerId} aria-invalid={Boolean(fieldError("ownerId"))} aria-describedby={describedBy("ownerId")} onChange={(event) => update("ownerId", event.target.value)}><option value="">Unassigned</option>{options.owners.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </Field>
        <Field label="Classification" required id="asset-classification" error={fieldError("classification")}>
          <select id="asset-classification" name="classification" value={draft.classification} aria-invalid={Boolean(fieldError("classification"))} aria-describedby={describedBy("classification")} onChange={(event) => update("classification", event.target.value)}><option value="highly_confidential">Highly Confidential</option><option value="confidential">Confidential</option><option value="internal_use_only">Internal Use Only</option><option value="public">Public</option></select>
        </Field>
        <Field label="Business criticality" required id="asset-valueCriticality" error={fieldError("valueCriticality")}>
          <select id="asset-valueCriticality" name="valueCriticality" value={draft.valueCriticality} aria-invalid={Boolean(fieldError("valueCriticality"))} aria-describedby={describedBy("valueCriticality")} onChange={(event) => update("valueCriticality", event.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        </Field>
      </div>
      <p className={styles.statusNote}>Classification guides handling. Criticality records business impact. Neither proves safeguards are operating.</p>
    </fieldset>

    <fieldset className={styles.section}>
      <legend>Safeguards and lifecycle</legend>
      <p className={styles.sectionHelp}>Keep operational notes useful while preserving the difference between recorded safeguards and reviewed evidence.</p>
      <Field label="Security controls" id="asset-securityControls" error={fieldError("securityControls")} help="Describe safeguards recorded for this asset. Verify them through managed evidence and review workflows.">
        <textarea id="asset-securityControls" name="securityControls" rows={5} maxLength={10000} value={draft.securityControls} aria-invalid={Boolean(fieldError("securityControls"))} aria-describedby={describedBy("securityControls", "asset-securityControls-help")} onChange={(event) => update("securityControls", event.target.value)} />
      </Field>
      <div className={styles.twoColumns}>
        <Field label="Expected lifespan" id="asset-lifespan" error={fieldError("lifespan")}><input id="asset-lifespan" name="lifespan" maxLength={120} value={draft.lifespan} aria-invalid={Boolean(fieldError("lifespan"))} aria-describedby={describedBy("lifespan")} onChange={(event) => update("lifespan", event.target.value)} /></Field>
        <Field label="Recorded information date" id="asset-lastUpdated" error={fieldError("lastUpdated")} help="A user-entered date for the asset information, separate from the system edit version."><input id="asset-lastUpdated" name="lastUpdated" type="date" value={draft.lastUpdated} aria-invalid={Boolean(fieldError("lastUpdated"))} aria-describedby={describedBy("lastUpdated", "asset-lastUpdated-help")} onChange={(event) => update("lastUpdated", event.target.value)} /></Field>
      </div>
      <Field label="Remarks" id="asset-remarks" error={fieldError("remarks")}><textarea id="asset-remarks" name="remarks" rows={4} maxLength={10000} value={draft.remarks} aria-invalid={Boolean(fieldError("remarks"))} aria-describedby={describedBy("remarks")} onChange={(event) => update("remarks", event.target.value)} /></Field>
    </fieldset>

    <div className={styles.actions}>
      <p>Only workspace operators can {mode === "create" ? "create" : "edit"} assets.</p>
      <div><Link className="button secondary" href={cancelHref}>Cancel</Link><button className="button primary" disabled={pending}>{pending ? "Saving…" : mode === "create" ? "Create asset" : "Save asset"}</button></div>
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
