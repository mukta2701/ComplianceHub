"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Card, Pill } from "@/components/ui";
import { contributionPermissions, contributionTime, type Contribution, type ContributionState } from "@/features/tasks/domain/contributions";
import { submitTaskContributionAction, reviewTaskContributionAction } from "./contribution-actions";

type Props = { taskId: string; ownerId: string | null; userId: string; role: string; status: string; assignmentRevision: number; requestId: string; names: Record<string,string>; contributions: (Contribution & { reviewRequestId: string })[] };
function Result({ state }: { state: ContributionState }) {
  return <>{state.error && <p role="alert" style={{ color: "var(--red, #a12622)" }}>{state.error}</p>}{state.success && <p role="status">{state.success}</p>}</>;
}
function SubmitForm({ taskId, assignmentRevision, requestId, resubmitting }: Pick<Props,"taskId"|"assignmentRevision"|"requestId"> & { resubmitting: boolean }) {
  const [state, action, pending] = useActionState(submitTaskContributionAction, {});
  const [note, setNote] = useState("");
  return <form action={action} style={{ display: "grid", gap: "10px" }}>
    <h2 style={{ margin: 0, fontSize: "17px" }}>{resubmitting ? "Submit an updated response" : "Submit work for review"}</h2>
    <p style={{ margin: 0 }}>Describe what you completed, what is blocked, and where the reviewer can verify it. Include an optional source URL in your note.</p>
    {resubmitting && <p style={{ margin: 0 }}>Your earlier submission and the review note remain in history below.</p>}
    <input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="assignmentRevision" value={assignmentRevision} /><input type="hidden" name="requestId" value={requestId} />
    <label htmlFor="contribution-note">Work note</label>
    <textarea id="contribution-note" name="note" value={note} onChange={(event) => setNote(event.target.value)} className="field" rows={5} maxLength={10000} required style={{ width: "100%", resize: "vertical" }} />
    <Result state={state} />
    <button className="button primary" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</button>
  </form>;
}
function ReviewForm({ taskId, contributionId, requestId }: { taskId: string; contributionId: string; requestId: string }) {
  const [state, action, pending] = useActionState(reviewTaskContributionAction, {});
  const [rationale, setRationale] = useState("");
  return <form action={action} style={{ display: "grid", gap: "10px", marginTop: "16px" }}>
    <h3 style={{ margin: 0 }}>Review submission</h3>
    <p style={{ margin: 0 }}>Check this exact note and its sources. Accepting creates linked note evidence; it does not verify a finding.</p>
    <input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="contributionId" value={contributionId} /><input type="hidden" name="requestId" value={requestId} />
    <label htmlFor={`review-${contributionId}`}>Review note</label>
    <textarea id={`review-${contributionId}`} name="rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} className="field" rows={3} required maxLength={2000} style={{ width: "100%", resize: "vertical" }} />
    <Result state={state} />
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
      <button className="button primary" name="decision" value="accepted" disabled={pending} style={{ flex: "1 1 180px" }}>Accept evidence</button>
      <button className="button secondary" name="decision" value="changes_requested" disabled={pending} style={{ flex: "1 1 180px" }}>Request changes</button>
    </div>
  </form>;
}
export function TaskContributions(props: Props) {
  const { canSubmit, reviewableIds } = contributionPermissions(props);
  const closed = props.status === "done" || props.status === "cancelled";
  const currentPending = props.contributions.some((c) => c.decision === "pending" && c.assignment_revision === props.assignmentRevision);
  return <Card style={{ padding: "22px", marginTop: "16px" }}>
    <p style={{ marginTop: 0 }}>Submitting or accepting evidence does not complete the task or verify a finding.</p>
    {canSubmit && <SubmitForm key={`${props.assignmentRevision}-${props.contributions.length}`} taskId={props.taskId} assignmentRevision={props.assignmentRevision} requestId={props.requestId} resubmitting={props.contributions.some((c) => c.decision === "changes_requested" && c.assignment_revision === props.assignmentRevision)} />}
    {closed && currentPending && <p>This task is closed. A workspace coordinator must reopen it before this saved note can be reviewed.</p>}
    {!closed && !canSubmit && currentPending && props.ownerId === props.userId && <p><strong>Waiting for review.</strong> A different workspace coordinator must review your saved note.</p>}
    <h2 style={{ fontSize: "17px", marginTop: "24px" }}>Submission history</h2>
    {!props.contributions.length && <p>No work has been submitted for review yet.</p>}
    <div style={{ display: "grid", gap: "16px" }}>
      {props.contributions.map((c) => {
        const obsolete = c.decision === "pending" && c.assignment_revision !== props.assignmentRevision;
        const closedPending = c.decision === "pending" && closed;
        const label = obsolete ? "Assignment changed — no longer reviewable" : closedPending ? "Task closed — no longer reviewable" : c.decision === "pending" ? "Awaiting review" : c.decision === "accepted" ? "Accepted" : "Changes requested";
        return <article key={c.id} style={{ borderTop: "1px solid var(--line, #e0e4ec)", paddingTop: "16px", overflowWrap: "anywhere" }}>
          <Pill tone={obsolete || closedPending ? "neutral" : c.decision === "accepted" ? "green" : "amber"}>{label}</Pill>
          <p><strong>{props.names[c.submitter_id] ?? "Former workspace member"}</strong> · Submitted <time dateTime={c.created_at}>{contributionTime(c.created_at)}</time></p>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.note}</p>
          {c.reviewed_at && <div style={{ background: "var(--surface-muted, #f5f7fb)", padding: "12px", borderRadius: "8px" }}>
            <p style={{ marginTop: 0 }}><strong>{props.names[c.reviewer_id ?? ""] ?? "Former coordinator"}</strong> · Reviewed <time dateTime={c.reviewed_at}>{contributionTime(c.reviewed_at)}</time></p>
            <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{c.rationale}</p>
          </div>}
          {c.evidence_id && <p>{props.role === "owner" || props.role === "admin" ? <Link href={`/app/evidence?evidence=${c.evidence_id}#evidence-${c.evidence_id}`}>Open accepted evidence</Link> : "This accepted note is saved as linked evidence."}</p>}
          {reviewableIds.includes(c.id) && <ReviewForm taskId={props.taskId} contributionId={c.id} requestId={c.reviewRequestId} />}
        </article>;
      })}
    </div>
  </Card>;
}
