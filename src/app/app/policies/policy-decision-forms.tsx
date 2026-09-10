"use client";

import { useActionState } from "react";
import { unstable_rethrow } from "next/navigation";
import { submitPolicyAcceptanceAction, submitPolicyApprovalAction, submitPolicyStatusAction } from "./policy-decision-actions";
import styles from "./policy-workspace.module.css";
import type { PolicyDecisionState } from "./policy-decision-actions";

type RecordPin = { id: string; version: number; revision: number };

function Result({ error, success }: { error?: string; success?: string }) {
  return <>{error && <p className={styles.actionError} role="alert">{error}</p>}{success && <p className={styles.actionSuccess} role="status">{success}</p>}</>;
}

function useRecoverablePolicyAction(serverAction: (previous: PolicyDecisionState, form: FormData) => Promise<PolicyDecisionState>, uncertainMessage: string) {
  return useActionState(async (previous: PolicyDecisionState, form: FormData) => {
    try { return await serverAction(previous, form); }
    catch (error) { unstable_rethrow(error); return { error: uncertainMessage }; }
  }, {});
}

export function PolicyApproveForm({ id, version, revision }: RecordPin) {
  const [state, action, pending] = useRecoverablePolicyAction(submitPolicyApprovalAction, "Could not confirm whether the policy was approved. Refresh and inspect the saved status before trying again.");
  return <form action={action} aria-busy={pending}><input type="hidden" name="id" value={id} /><input type="hidden" name="expectedRevision" value={revision} /><input type="hidden" name="expectedVersion" value={version} /><button className="button primary" disabled={pending}>{pending ? "Approving…" : "Approve policy"}</button><Result {...state} /></form>;
}

export function PolicyStatusForm({ id, version, revision }: RecordPin) {
  const [state, action, pending] = useRecoverablePolicyAction(submitPolicyStatusAction, "Could not confirm whether the policy status changed. Refresh and inspect the saved status before trying again.");
  return <form action={action} className={styles.linkForm} aria-busy={pending}><input type="hidden" name="id" value={id} /><input type="hidden" name="expectedRevision" value={revision} /><input type="hidden" name="expectedVersion" value={version} /><label>Move policy to<select name="status" className="field" required defaultValue="" aria-label="Policy status"><option value="" disabled>Select a status</option><option value="draft">Draft</option><option value="in_review">In review</option><option value="archived">Archived</option></select></label><button className="button secondary" disabled={pending}>{pending ? "Changing…" : "Set status"}</button><Result {...state} /></form>;
}

export function PolicyAcceptanceForm({ id, version }: { id: string; version: number }) {
  const [state, action, pending] = useRecoverablePolicyAction(submitPolicyAcceptanceAction, "Could not confirm whether acceptance was recorded. Refresh and inspect this version before trying again.");
  return <form action={action} aria-busy={pending}><input type="hidden" name="id" value={id} /><input type="hidden" name="expectedVersion" value={version} /><button className="button primary" disabled={pending}>{pending ? "Recording…" : "I accept this policy"}</button><Result {...state} /></form>;
}
