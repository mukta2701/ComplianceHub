"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Card, Pill } from "@/components/ui";
import { contributionPermissions, contributionTime, type Contribution, type ContributionState } from "@/features/tasks/domain/contributions";
import { submitTaskContributionAction, reviewTaskContributionAction } from "./contribution-actions";
import styles from "./task-contributions.module.css";

type Props = { taskId: string; ownerId: string | null; userId: string; role: string; status: string; assignmentRevision: number; requestId: string; names: Record<string,string>; contributions: (Contribution & { reviewRequestId: string })[] };

function Result({ state }: { state: ContributionState }) {
  return <>{state.error && <p role="alert" className={styles.error}>{state.error}</p>}{state.success && <p role="status" className={styles.success}>{state.success}</p>}</>;
}

function SubmitForm({ taskId, assignmentRevision, requestId, resubmitting }: Pick<Props,"taskId"|"assignmentRevision"|"requestId"> & { resubmitting: boolean }) {
  const [state, action, pending] = useActionState(submitTaskContributionAction, {});
  const [note, setNote] = useState("");
  return <form action={action} className={styles.form}>
    <div><span className={styles.kicker}>Contributor action</span><h2>{resubmitting ? "Submit an updated response" : "Submit work for review"}</h2></div>
    <p>Describe what you completed, what is blocked, and where the reviewer can verify it. Include an optional source URL in your note.</p>
    {resubmitting && <p className={styles.contextNote}>Your earlier submission and the review note remain in history below.</p>}
    <input type="hidden" name="taskId" value={taskId} />
    <input type="hidden" name="assignmentRevision" value={assignmentRevision} />
    <input type="hidden" name="requestId" value={requestId} />
    <label htmlFor="contribution-note">Work note</label>
    <textarea id="contribution-note" name="note" value={note} onChange={(event) => setNote(event.target.value)} className="field" rows={6} maxLength={10000} required />
    <Result state={state} />
    <button className="button primary" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</button>
  </form>;
}

function ReviewForm({ taskId, contributionId, requestId }: { taskId: string; contributionId: string; requestId: string }) {
  const [state, action, pending] = useActionState(reviewTaskContributionAction, {});
  const [rationale, setRationale] = useState("");
  return <form action={action} className={styles.reviewForm}>
    <div><span className={styles.kicker}>Reviewer decision</span><h3>Review this submission</h3></div>
    <p>Check this exact note and its sources. Acceptance creates linked note evidence; task and finding statuses stay unchanged.</p>
    <input type="hidden" name="taskId" value={taskId} />
    <input type="hidden" name="contributionId" value={contributionId} />
    <input type="hidden" name="requestId" value={requestId} />
    <label htmlFor={"review-" + contributionId}>Review note</label>
    <textarea id={"review-" + contributionId} name="rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} className="field" rows={4} required maxLength={2000} />
    <Result state={state} />
    <div className={styles.reviewActions}>
      <button className="button primary" name="decision" value="accepted" disabled={pending}>Accept evidence</button>
      <button className="button secondary" name="decision" value="changes_requested" disabled={pending}>Request changes</button>
    </div>
  </form>;
}

export function TaskContributions(props: Props) {
  const { canSubmit, reviewableIds } = contributionPermissions(props);
  const closed = props.status === "done" || props.status === "cancelled";
  const currentContributions = props.contributions.filter((item) => item.assignment_revision === props.assignmentRevision);
  const latest = currentContributions[0];
  const currentPending = currentContributions.some((item) => item.decision === "pending");
  const submittedLabel = latest ? "Submitted" : canSubmit ? "Ready to submit" : "Not submitted";
  const reviewedLabel = latest?.decision === "accepted" ? "Accepted" : latest?.decision === "changes_requested" ? "Changes requested" : latest?.decision === "pending" && closed ? "Review blocked" : latest?.decision === "pending" ? "Review pending" : "Not submitted";

  return <Card className={styles.panel} aria-label="Work submission and review">
    <div className={styles.panelHeader}>
      <div><span className={styles.kicker}>Evidence workflow</span><h2>Work submission and review</h2></div>
      {currentPending && !closed && <Pill tone="amber">Review pending</Pill>}
      {latest?.decision === "accepted" && <Pill tone="green">Evidence accepted</Pill>}
      {latest?.decision === "changes_requested" && <Pill tone="amber">Changes requested</Pill>}
    </div>
    <ol className={styles.progress} aria-label="Task review progress">
      <li className={props.ownerId ? styles.complete : styles.active}><i>1</i><span><strong>{props.ownerId ? "Assigned" : "Unassigned"}</strong><small>{props.ownerId ? "Owner named" : "Owner needed"}</small></span></li>
      <li className={latest ? styles.complete : styles.active}><i>2</i><span><strong>{submittedLabel}</strong><small>Work note</small></span></li>
      <li className={latest && latest.decision !== "pending" ? styles.complete : currentPending && !closed ? styles.active : ""}><i>3</i><span><strong>{reviewedLabel}</strong><small>Human decision</small></span></li>
    </ol>
    <p className={styles.boundary}>Submitting or accepting evidence does not complete the task or verify a finding.</p>

    {canSubmit && <SubmitForm key={props.assignmentRevision + "-" + props.contributions.length} taskId={props.taskId} assignmentRevision={props.assignmentRevision} requestId={props.requestId} resubmitting={props.contributions.some((item) => item.decision === "changes_requested" && item.assignment_revision === props.assignmentRevision)} />}
    {closed && currentPending && <p className={styles.contextNote}>This task is closed. A workspace coordinator must reopen it before this saved note can be reviewed.</p>}
    {!closed && !canSubmit && currentPending && props.ownerId === props.userId && <p className={styles.contextNote}><strong>Waiting for review.</strong> A different workspace coordinator must review your saved note.</p>}

    <div className={styles.historyHeader}><h2>Submission history</h2><span>{props.contributions.length} record{props.contributions.length === 1 ? "" : "s"}</span></div>
    {!props.contributions.length && <div className={styles.empty}><strong>No submissions yet</strong><p>The assigned owner’s work notes and review decisions will appear here.</p></div>}
    <div className={styles.history}>
      {props.contributions.map((item) => {
        const obsolete = item.decision === "pending" && item.assignment_revision !== props.assignmentRevision;
        const closedPending = item.decision === "pending" && closed;
        const label = obsolete ? "Assignment changed — no longer reviewable" : closedPending ? "Task closed — no longer reviewable" : item.decision === "pending" ? "Awaiting review" : item.decision === "accepted" ? "Accepted" : "Changes requested";
        return <article key={item.id} className={styles.historyItem}>
          <div className={styles.historyMeta}><Pill tone={obsolete || closedPending ? "neutral" : item.decision === "accepted" ? "green" : "amber"}>{label}</Pill><time dateTime={item.created_at}>{contributionTime(item.created_at)}</time></div>
          <p className={styles.person}><strong>{props.names[item.submitter_id] ?? "Former workspace member"}</strong> submitted</p>
          <p className={styles.submission}>{item.note}</p>
          {item.reviewed_at && <div className={styles.decision}>
            <span className={styles.kicker}>Review decision</span>
            <p><strong>{props.names[item.reviewer_id ?? ""] ?? "Former coordinator"}</strong> · Reviewed <time dateTime={item.reviewed_at}>{contributionTime(item.reviewed_at)}</time></p>
            <p>{item.rationale}</p>
          </div>}
          {item.evidence_id && <p className={styles.evidenceLink}>{props.role === "owner" || props.role === "admin" ? <Link href={"/app/evidence?evidence=" + item.evidence_id + "#evidence-" + item.evidence_id}>Open accepted evidence</Link> : "This accepted note is saved as linked evidence."}</p>}
          {reviewableIds.includes(item.id) && <ReviewForm taskId={props.taskId} contributionId={item.id} requestId={item.reviewRequestId} />}
        </article>;
      })}
    </div>
  </Card>;
}
