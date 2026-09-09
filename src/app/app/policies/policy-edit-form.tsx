"use client";

import { startTransition, useActionState, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { savePolicyEditAction, type PolicyEditState } from "./policy-edit-actions";

export type PolicyEditValues = {
  id: string; reference: string; title: string; body: string; version: number;
  ownerId: string | null; reviewDue: string | null;
};

export function PolicyEditForm({ policy, owners }: { policy: PolicyEditValues; owners: { id: string; name: string }[] }) {
  const [draftVersion, setDraftVersion] = useState(policy.version);
  const [state, action, pending] = useActionState(async (previous: PolicyEditState, form: FormData): Promise<PolicyEditState> => {
    try {
      const result = await savePolicyEditAction(previous, form);
      if (result.version) setDraftVersion(result.version);
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
  }} aria-busy={pending} className="app-form" style={{ padding: "16px 0 0" }}>
    <input type="hidden" name="id" value={policy.id} />
    <input type="hidden" name="expectedVersion" value={draftVersion} />
    <div className="form-grid">
      <label>Reference<input name="reference" required maxLength={40} value={draft.reference} onChange={(event) => change("reference", event.target.value)} /></label>
      <label>Title<input name="title" required maxLength={200} value={draft.title} onChange={(event) => change("title", event.target.value)} /></label>
      <label>Policy owner<select name="ownerId" aria-label="Policy owner" value={draft.ownerId} onChange={(event) => change("ownerId", event.target.value)}>
        <option value="">Unassigned</option>
        {policy.ownerId && !owners.some((owner) => owner.id === policy.ownerId) && <option value={policy.ownerId}>Current owner (not in member list)</option>}
        {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
      </select></label>
      <label>Review due<input name="reviewDue" type="date" value={draft.reviewDue} onChange={(event) => change("reviewDue", event.target.value)} /></label>
    </div>
    <label>Policy content<textarea name="body" maxLength={100000} rows={8} value={draft.body} onChange={(event) => change("body", event.target.value)} /></label>
    <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>Changing the content bumps the version and asks members to re-accept.</p>
    {!pending && state.error && <p role="alert">{state.error}</p>}
    {!pending && !edited && state.success && <p role="status">{state.success}</p>}
    <button className="button primary" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
  </form>;
}
