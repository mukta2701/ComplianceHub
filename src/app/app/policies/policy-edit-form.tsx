"use client";

import Link from "next/link";
import { PolicyFields } from "./policy-fields";
import styles from "../risks/risk-form.module.css";
import { startTransition, useActionState, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { savePolicyEditAction, type PolicyEditState } from "./policy-edit-actions";

export type PolicyEditValues = {
  id: string; reference: string; title: string; body: string; version: number; revision: number;
  ownerId: string | null; reviewDue: string | null;
};

export function PolicyEditForm({ policy, owners }: { policy: PolicyEditValues; owners: { id: string; name: string }[] }) {
  const [draftRevision, setDraftRevision] = useState(policy.revision);
  const [draftVersion, setDraftVersion] = useState(policy.version);
  const [state, action, pending] = useActionState(async (previous: PolicyEditState, form: FormData): Promise<PolicyEditState> => {
    try {
      const result = await savePolicyEditAction(previous, form);
      if (result.version) setDraftVersion(result.version);
      if (result.revision) setDraftRevision(result.revision);
      return result;
    } catch (error) {
      unstable_rethrow(error);
      return { error: "Could not confirm whether the policy was saved. Your entries are still shown. Copy them before refreshing and check the saved policy before trying again." };
    }
  }, {});
  const [draft, setDraft] = useState({ reference: policy.reference, title: policy.title, body: policy.body, ownerId: policy.ownerId ?? "", reviewDue: policy.reviewDue ?? "" });
  const [edited, setEdited] = useState(false);
  function change(field: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setEdited(true);
  }
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setEdited(false);
    startTransition(() => action(form));
  }} aria-busy={pending} className={styles.form}>
    <input type="hidden" name="id" value={policy.id} />
    <input type="hidden" name="expectedVersion" value={draftVersion} />
    <input type="hidden" name="expectedRevision" value={draftRevision} />
    <PolicyFields draft={draft} owners={owners} errors={state.fieldErrors} change={change} />
    <p className={styles.statusNote}>Changing policy content creates a new version. Earlier acceptance stays recorded; acceptance of the new version opens when the policy is approved.</p>
    {!pending && state.error && <p className={styles.error} role="alert">{state.error}</p>}
    {!pending && !edited && state.success && <p role="status">{state.success}</p>}
    <div className={styles.actions}><p>Save the document before making an approval decision.</p><div><Link className="button secondary" href={`/app/policies/${policy.id}`}>Back to saved policy</Link><button className="button primary" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button></div></div>
  </form>;
}
