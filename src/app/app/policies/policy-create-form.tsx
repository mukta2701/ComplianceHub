"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { createPolicyFormAction, type PolicyFormState } from "./policy-create-actions";
import { PolicyFields, type PolicyDraft, type PolicyOwnerOption } from "./policy-fields";
import styles from "../risks/risk-form.module.css";
import workspaceStyles from "./policy-workspace.module.css";
import { Icon } from "@/components/icons";

type PolicyTemplateOption = { slug: string; reference: string; title: string; summary: string; body: string };

export function PolicyCreateForm({ initial, owners, templates = [], initialTemplateSlug }: { initial: Pick<PolicyDraft, "reference" | "title" | "body">; owners: PolicyOwnerOption[]; templates?: readonly PolicyTemplateOption[]; initialTemplateSlug?: string }) {
  const [draft, setDraft] = useState<PolicyDraft>({ ...initial, ownerId: "", reviewDue: "" });
  const [activeTemplate, setActiveTemplate] = useState(initialTemplateSlug ?? "");
  const [state, action, pending] = useActionState(async (previous: PolicyFormState, form: FormData) => {
    try { return await createPolicyFormAction(previous, form); }
    catch (error) {
      unstable_rethrow(error);
      return { error: "Could not confirm whether the policy was created. Your entries are still shown. Copy them before refreshing, then check the library before trying again." };
    }
  }, {});
  const hasWriting = Boolean(draft.reference.trim() || draft.title.trim() || draft.body.trim());
  function replaceWriting(next: Pick<PolicyDraft, "reference" | "title" | "body">, slug: string) {
    if (hasWriting && !window.confirm("Replace the reference, title and policy content you have entered?")) return;
    setDraft((current) => ({ ...current, ...next }));
    setActiveTemplate(slug);
  }
  return <>
    <details className={`card ${workspaceStyles.templates}`}><summary>Start from a template (optional)</summary>
      <div className="template-picker-head"><h2>Choose a starting point</h2><p>Templates pre-fill the document. ComplianceHub asks before replacing anything you have written.</p></div>
      <ul className="template-list">
        {templates.map((template) => { const active = template.slug === activeTemplate; return <li key={template.slug}>
          <button type="button" className={`template-card${active ? " active" : ""}`} aria-pressed={active} onClick={() => replaceWriting(template, template.slug)}>
            <span className="template-ref">{template.reference}</span><b>{template.title}</b><small>{template.summary}</small>
            <span className="template-cue"><Icon name={active ? "check" : "arrow"} />{active ? "Loaded below" : "Use this template"}</span>
          </button>
        </li>; })}
      </ul>
      {activeTemplate && <button type="button" className="template-clear" onClick={() => replaceWriting({ reference: "", title: "", body: "" }, "")}>Clear template and start from blank</button>}
    </details>
    {activeTemplate && <p className={workspaceStyles.notice}>Template loaded. Review and adapt its content before approval.</p>}
    <form action={action} className={styles.form} aria-busy={pending} id="policy-authoring-form">
    <PolicyFields draft={draft} owners={owners} errors={state.fieldErrors} change={(field, value) => setDraft((current) => ({ ...current, [field]: value }))} />
    {!pending && state.error && <p className={styles.error} role="alert">{state.error}</p>}
    <div className={styles.actions}><p>Created as a draft. Approval is a separate step.</p><div><Link className="button secondary" href="/app/policies">Cancel</Link><button className="button primary" disabled={pending}>{pending ? "Creating…" : "Create policy"}</button></div></div>
    </form>
  </>;
}
