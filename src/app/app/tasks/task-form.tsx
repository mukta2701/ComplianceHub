"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useState } from "react";
import { createTaskFormAction, updateTaskFormAction, type TaskFormState } from "./actions";
import styles from "./task-form.module.css";

export type TaskFormValues = {
  title: string;
  detail: string;
  ownerId: string;
  dueOn: string;
  recurrence: string;
  controlId: string;
  riskId: string;
};

type Option = { id: string; label: string };

export function TaskForm({ mode, taskId, expectedUpdatedAt, values, options, cancelHref }: {
  mode: "create" | "edit";
  taskId?: string;
  expectedUpdatedAt?: string;
  values: TaskFormValues;
  options: { members: Option[]; controls: Option[]; risks: Option[] };
  cancelHref: string;
}) {
  const [draft, setDraft] = useState(values);
  const [editContext] = useState(() => ({ taskId, expectedUpdatedAt }));
  const serverAction = mode === "create" ? createTaskFormAction : updateTaskFormAction;
  const [state, action, pending] = useActionState<TaskFormState, FormData>(async (previous, formData) => {
    try {
      return await serverAction(previous, formData);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "Could not confirm whether the task was saved. Your entries are still shown. Copy them before refreshing and check the work queue before trying again." };
    }
  }, {});

  function update(field: keyof TaskFormValues, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  function fieldError(field: keyof TaskFormValues) {
    return state.fieldErrors?.[field]?.[0];
  }

  return <form action={action} aria-busy={pending} className={styles.form}>
    {editContext.taskId && <input type="hidden" name="id" value={editContext.taskId} />}
    {editContext.expectedUpdatedAt && <input type="hidden" name="expectedUpdatedAt" value={editContext.expectedUpdatedAt} />}

    <fieldset className={styles.section}>
      <legend>Task brief</legend>
      <p className={styles.sectionHelp}>Provide a clear outcome and enough detail for the work to be understood and reviewed.</p>
      <div className={styles.field}>
        <div className={styles.fieldLabel}><label htmlFor="task-title">Title</label><span aria-hidden="true" className={styles.required}>Required</span></div>
        <input id="task-title" name="title" required maxLength={200} value={draft.title} aria-invalid={Boolean(fieldError("title"))} aria-describedby={fieldError("title") ? "task-title-error" : undefined} onChange={(event) => update("title", event.target.value)} />
        {fieldError("title") && <small id="task-title-error" className={styles.fieldError}>{fieldError("title")}</small>}
      </div>
      <div className={styles.field}>
        <div className={styles.fieldLabel}><label htmlFor="task-detail">Detail</label><span aria-hidden="true" className={styles.optional}>Optional</span></div>
        <textarea id="task-detail" name="detail" rows={5} maxLength={10000} value={draft.detail} aria-invalid={Boolean(fieldError("detail"))} aria-describedby={`task-detail-help${fieldError("detail") ? " task-detail-error" : ""}`} onChange={(event) => update("detail", event.target.value)} />
        <small id="task-detail-help">Describe the expected outcome, important context and what should be submitted for review.</small>
        {fieldError("detail") && <small id="task-detail-error" className={styles.fieldError}>{fieldError("detail")}</small>}
      </div>
    </fieldset>

    <fieldset className={styles.section}>
      <legend>Ownership and timing</legend>
      <p className={styles.sectionHelp}>Assign an owner and deadline when they are known. Missing owners and due dates remain clearly identified.</p>
      <div className={styles.threeColumns}>
        <div className={styles.field}>
          <div className={styles.fieldLabel}><label htmlFor="task-owner">Owner</label><span aria-hidden="true" className={styles.optional}>Optional</span></div>
          <select id="task-owner" name="ownerId" value={draft.ownerId} onChange={(event) => update("ownerId", event.target.value)}><option value="">Unassigned</option>{options.members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}><label htmlFor="task-due-on">Due date</label><span aria-hidden="true" className={styles.optional}>Optional</span></div>
          <input id="task-due-on" name="dueOn" type="date" value={draft.dueOn} aria-invalid={Boolean(fieldError("dueOn"))} aria-describedby={fieldError("dueOn") ? "task-due-on-error" : undefined} onChange={(event) => update("dueOn", event.target.value)} />
          {fieldError("dueOn") && <small id="task-due-on-error" className={styles.fieldError}>{fieldError("dueOn")}</small>}
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}><label htmlFor="task-recurrence">Recurrence</label><span aria-hidden="true" className={styles.optional}>Optional</span></div>
          <select id="task-recurrence" name="recurrence" value={draft.recurrence} onChange={(event) => update("recurrence", event.target.value)}><option value="">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select>
        </div>
      </div>
      {mode === "edit" && <p className={styles.ownerNotice}>Changing the owner preserves earlier submissions in history. Only the current owner can submit new work.</p>}
      <p className={styles.recurrenceHelp}>Recurring work creates its next occurrence when completed and a due date is set.</p>
    </fieldset>

    <fieldset className={styles.section}>
      <legend>Linked records <span aria-hidden="true" className={styles.optional}>Optional</span></legend>
      <p className={styles.sectionHelp}>Connect the task to the control or risk that explains why the work matters.</p>
      <div className={styles.twoColumns}>
        <div className={styles.field}>
          <label htmlFor="task-control">Linked control</label>
          <select id="task-control" name="controlId" value={draft.controlId} onChange={(event) => update("controlId", event.target.value)}><option value="">None</option>{options.controls.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </div>
        <div className={styles.field}>
          <label htmlFor="task-risk">Linked risk</label>
          <select id="task-risk" name="riskId" value={draft.riskId} onChange={(event) => update("riskId", event.target.value)}><option value="">None</option>{options.risks.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </div>
      </div>
    </fieldset>

    <div className={styles.actions}>
      <p>Only workspace operators can {mode === "create" ? "create" : "edit"} tasks.</p>
      <div><Link className="button secondary" href={cancelHref}>Cancel</Link><button className="button primary" disabled={pending}>{pending ? "Saving…" : mode === "create" ? "Create task" : "Save task"}</button></div>
    </div>
    {!pending && state.error && <p className={state.conflict ? styles.conflict : styles.error} role="alert">{state.error}</p>}
  </form>;
}
