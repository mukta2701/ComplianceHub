"use client";
import styles from "./baseline.module.css";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveBaselineAction } from "./actions";
import type { BaselineState } from "@/features/baselines/domain/summary";

export function BaselineForm({ objective, assessmentId, revision, requestId, assessments }: {
  objective: string; assessmentId: string | null; revision: number; requestId: string;
  assessments: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState<BaselineState, FormData>(saveBaselineAction, {});
  const [draftObjective, setDraftObjective] = useState(objective);
  const [selectedAssessment, setSelectedAssessment] = useState(assessmentId ?? "");
  const router = useRouter();
  useEffect(() => { if (state.snapshotId) router.replace(`/app/baseline?snapshot=${state.snapshotId}`, { scroll: false }); }, [state.snapshotId, router]);
  return <form className={styles.form} action={action} style={{ display: "grid", gap: "12px" }}>
    <input type="hidden" name="revision" value={state.revision ?? revision} />
    <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
    <label>Objective<textarea name="objective" value={draftObjective} onChange={(event) => setDraftObjective(event.target.value)} maxLength={2000} required rows={3} placeholder="What should this baseline help your team decide?" /></label>
    <label>Assessment<select name="assessmentId" value={selectedAssessment} onChange={(event) => setSelectedAssessment(event.target.value)}><option value="">No assessment selected yet</option>{assessments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <p style={{ margin: 0 }}>Save progress to resume later, or save a dated baseline from the records available now. Missing scope, answers and evidence stay visible.</p>
    {state.error && <p role="alert">{state.error}</p>}
    {state.success && <p role="status">{state.success}</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <button className="button secondary" name="intent" value="progress" disabled={pending}>Save progress</button>
      <button className="button primary" name="intent" value="snapshot" disabled={pending}>Save dated baseline</button>
    </div>
  </form>;
}
