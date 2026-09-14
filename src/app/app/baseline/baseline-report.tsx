import Link from "next/link";
import { Card, Pill } from "@/components/ui";
import { compareBaselines, summariseBaseline, type BaselinePayload } from "@/features/baselines/domain/summary";
import { RISK_BAND_LABEL } from "@/features/risks/domain/risks";

export function formatBaselineDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
const cardStyle = { padding: "20px", marginTop: "16px", overflowWrap: "anywhere" as const };
export function BaselineReport({ payload, previous, operator }: { payload: BaselinePayload; previous: BaselinePayload | null; operator: boolean }) {
  const summary = summariseBaseline(payload);
  const comparison = compareBaselines(payload, previous);
  const materialRisks = summary.risks.filter((risk) => risk.band === "high" || risk.band === "very_high" || risk.exceedsAppetite);
  const scope = payload.scope;
  const scopeFields = [
    ["Boundary and outcomes", scope?.scope_statement], ["Products and services", scope?.services], ["People and locations", scope?.locations],
    ["Information types", scope?.information_types], ["Dependencies", scope?.dependencies], ["Exclusions", scope?.exclusions],
  ];
  return <div aria-label="Saved baseline">
    <Card style={cardStyle}>
      <h3>Dated baseline</h3>
      <p>{payload.organisationName} · Saved {formatBaselineDate(payload.savedAt)} · Revision {payload.progressRevision}</p>
      <Pill tone={summary.partial ? "amber" : "blue"}>{summary.partial ? "Partial baseline" : "Starting inputs recorded"}</Pill>
      <h4>Objective</h4><p style={{ whiteSpace: "pre-wrap" }}>{payload.objective}</p>
      <p>This is a fixed record of the saved date. Current workspace records may have changed. Completeness describes the recorded inputs, not compliance.</p>
      <p><a href="#baseline-sources">Inspect the saved sources</a> · <Link href="/app/reports/readiness">Open existing readiness report</Link></p>
    </Card>
    <Card style={cardStyle}>
      <h3>Significant concerns</h3>
      <p><b>{summary.tasksOpen} open tasks</b> · {summary.overdueTasks.length} overdue · {summary.pendingReviews.length} notes awaiting review · {summary.evidence.expired} expired evidence records</p>
      <ul>
        {summary.overdueTasks.slice(0, 5).map((task) => <li key={task.id}><a href={`#task-${task.id}`}>Overdue: {task.title}</a> — due {task.due_on}, {task.owner_name || "no named owner"}.</li>)}
        {materialRisks.slice(0, 5).map((risk) => <li key={risk.id}><a href={`#risk-${risk.id}`}>{RISK_BAND_LABEL[risk.band]} recorded risk: {risk.title}</a>{risk.exceedsAppetite ? " — above the saved risk appetite." : "."}</li>)}
        {summary.unassignedTasks.length > 0 && <li><a href="#baseline-actions">{summary.unassignedTasks.length} open tasks have no accountable owner.</a></li>}
        {summary.unanswered > 0 && <li><a href="#baseline-assessment">{summary.unanswered} unanswered questions leave the starting position incomplete.</a></li>}
        {summary.pendingReviews.length > 0 && <li><a href="#baseline-reviews">{summary.pendingReviews.length} submitted notes need coordinator review.</a></li>}
      </ul>
      {summary.overdueTasks.length === 0 && materialRisks.length === 0 && summary.unassignedTasks.length === 0 && summary.unanswered === 0 && summary.pendingReviews.length === 0 && <p>No concerns were identified by these saved work and risk checks. Review the evidence limitations below.</p>}
    </Card>
    <Card style={cardStyle} id="baseline-actions">
      <h3>Decisions and next actions</h3>
      <p>These follow-ups come from saved records. They are requests for a coordinator or owner to act, not recorded approvals.</p>
      <ul>
        {summary.scopeGaps.length > 0 && <li><a href="#baseline-scope">Complete {summary.scopeGaps.length} missing scope fields.</a></li>}
        {!payload.assessment && <li><a href="#baseline-assessment">Choose an assessment to establish the starting questions.</a></li>}
        {summary.unassignedTasks.map((task) => <li key={`owner-${task.id}`}><a href={`#task-${task.id}`}>Assign an owner: {task.title}</a></li>)}
        {summary.undatedTasks.map((task) => <li key={`date-${task.id}`}><a href={`#task-${task.id}`}>Set a due date: {task.title}</a></li>)}
        {summary.pendingReviews.map((review) => <li key={review.id}><a href={`#review-${review.id}`}>Review submitted note: {payload.tasks.find((task) => task.id === review.task_id)?.title ?? "Saved task"}</a></li>)}
        {summary.assessmentGaps.length > 0 && <li><a href="#baseline-assessment">Review {summary.assessmentGaps.length} unanswered or gap answers and agree follow-up work.</a></li>}
        {summary.evidence.expired > 0 && <li><a href="#baseline-evidence">Review {summary.evidence.expired} expired evidence records and arrange current evidence.</a></li>}
      </ul>
      <h4>Recorded open work</h4>
      {summary.openTasks.length ? <div style={{ overflowX: "auto" }}><table className="data-table" style={{ width: "100%" }}><thead><tr><th>Task</th><th>Owner</th><th>Due date</th><th>Saved state</th></tr></thead><tbody>{summary.openTasks.map((task) => <tr key={task.id}><td><a href={`#task-${task.id}`}>{task.title}</a></td><td>{task.owner_name || (task.owner_id ? "Name unavailable" : "Unassigned")}</td><td>{task.due_on || "No due date"}</td><td>{task.status === "in_progress" ? "In progress" : "Open"}</td></tr>)}</tbody></table></div> : <p>No open tasks were captured.</p>}
    </Card>
    <Card style={cardStyle}>
      <h3>Evidence limitations</h3>
      <ul>{summary.scopeGaps.map((gap) => <li key={gap}>{gap}</li>)}{summary.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
    </Card>
    <Card style={cardStyle}>
      <h3>Changes since previous baseline</h3>
      {previous && <p>Previous saved date: {formatBaselineDate(previous.savedAt)}.</p>}
      <p>{comparison.reason}</p>
      {comparison.comparable && (comparison.changes.length ? <ul>{comparison.changes.map((change) => <li key={change}>{change}</li>)}</ul> : <p>No changes in the compared counts.</p>)}
    </Card>
    <Card style={cardStyle} id="baseline-sources">
      <h3>Saved source details</h3>
      <p>These copies and references were captured together. Links to current records may show later changes.</p>
      <section id="baseline-scope"><h4>Scope at the saved date</h4>
        <dl>{scopeFields.map(([label, value]) => <div key={label}><dt><b>{label}</b></dt><dd style={{ marginLeft: 0, whiteSpace: "pre-wrap" }}>{value?.trim() || "Not recorded"}</dd></div>)}</dl>
        <p>{scope ? `Scope updated ${formatBaselineDate(scope.updated_at)}.` : "No scope profile was recorded."} {operator && <Link href="/app/scope">Edit scope</Link>}</p>
      </section>
      <section id="baseline-assessment"><h4>Assessment answers</h4>
        <p>{payload.assessment ? `${payload.assessment.title} · assessment revision ${payload.assessment.revision} · catalogue ${payload.assessment.catalogue_version} · updated ${formatBaselineDate(payload.assessment.updated_at)}` : "No assessment selected."}</p>
        {operator && <p><Link href={payload.assessment ? `/app/assessment/${payload.assessment.id}` : "/app/assessment"}>Open assessment</Link></p>}
        {payload.questions.map((question) => <details key={question.id} id={`question-${question.id}`}><summary>{question.prompt} — {question.answer?.replaceAll("_", " ") ?? "Unanswered"}</summary><p style={{ whiteSpace: "pre-wrap" }}>{question.evidence_note || "No supporting evidence note recorded."}</p><small>Question reference: {question.id}{question.updated_at ? ` · answered ${formatBaselineDate(question.updated_at)}` : ""}</small></details>)}
      </section>
      <section><h4>Tasks at the saved date</h4>{payload.tasks.map((task) => <details key={task.id} id={`task-${task.id}`}><summary>{task.title} — {task.status.replaceAll("_", " ")}</summary><p>Owner: {task.owner_name || (task.owner_id ? "Name unavailable" : "Unassigned")} · Due: {task.due_on || "No due date"} · Updated: {formatBaselineDate(task.updated_at)}</p><Link href={`/app/tasks/${task.id}`}>Open task</Link></details>)}</section>
      <section id="baseline-reviews"><h4>Contribution and review history</h4>
        {!payload.contributions.length && <p>No contribution notes were captured.</p>}
        {payload.contributions.map((review) => <details key={review.id} id={`review-${review.id}`}><summary>{payload.tasks.find((task) => task.id === review.task_id)?.title ?? "Saved task"} — {review.decision === "pending" ? (summary.obsoletePendingReviews.includes(review) ? "No longer reviewable" : "Awaiting review") : review.decision === "accepted" ? "Accepted evidence" : "Changes requested"}</summary>
          <p style={{ whiteSpace: "pre-wrap" }}>{review.note}</p><p>Submitted by {review.submitter_name || "Name unavailable"} on {formatBaselineDate(review.created_at)}.</p>
          {review.rationale && <p style={{ whiteSpace: "pre-wrap" }}>Review note: {review.rationale}</p>}{review.reviewed_at && <p>Reviewed by {review.reviewer_name || "Name unavailable"} on {formatBaselineDate(review.reviewed_at)}.</p>}
          {review.evidence_id && <p><a href={`#evidence-${review.evidence_id}`}>Inspect accepted evidence</a></p>}
          <Link href={`/app/tasks/${review.task_id}`}>Open task and contribution history</Link>
        </details>)}
      </section>
      <section id="baseline-evidence"><h4>Evidence at the saved date</h4>
        <p>{summary.evidence.total} active records · {summary.evidence.expired} expired · {summary.evidence.expiring} expiring. Freshness uses the saved date and preserves explicitly stale or withdrawn states.</p>
        {summary.evidenceItems.map((item) => <details key={item.id} id={`evidence-${item.id}`}><summary>{item.title} — {item.status}</summary><p style={{ whiteSpace: "pre-wrap" }}>{item.description || "No description recorded."}</p><p>{item.kind} · Collected {item.collected_on} · Valid until {item.valid_until || "No expiry date recorded"} · Recorded {formatBaselineDate(item.created_at)}</p>{operator && <Link href={`/app/evidence?evidence=${item.id}#evidence-${item.id}`}>Open current evidence record</Link>}</details>)}
      </section>
      <section><h4>Recorded risks</h4><p>Risk bands use saved residual likelihood and impact with {payload.riskConfig ? "the workspace risk thresholds" : "the standard risk thresholds"}. Accepted risk remains a recorded human decision.</p>
        {summary.risks.map((risk) => <details key={risk.id} id={`risk-${risk.id}`}><summary>{risk.reference}: {risk.title} — {RISK_BAND_LABEL[risk.band]}</summary><p>State: {risk.status} · Owner: {risk.owner_name || "Unassigned"} · Review due: {risk.review_date || "No review date"} · Updated {formatBaselineDate(risk.updated_at)}</p><p>Residual likelihood {risk.residual_likelihood} × impact {risk.residual_impact}.</p>{operator && <Link href={`/app/risks/${risk.id}`}>Open current risk</Link>}</details>)}
      </section>
    </Card>
  </div>;
}
