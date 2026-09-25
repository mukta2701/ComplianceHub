import { Card, Pill } from "@/components/ui";
import {
  createPolicyFeedbackAction,
  decidePolicyFeedbackAction,
  replyPolicyFeedbackAction,
  setPolicyFeedbackStatusAction,
} from "@/app/app/policies/[id]/feedback-actions";

export type PolicyFeedbackThread = {
  id: string;
  subject: string;
  status: "open" | "resolved";
  decision: "accepted" | "declined" | null;
  decisionRationale: string | null;
  policyVersion: number;
  createdAt: string;
  resolvedAt: string | null;
  authorName: string;
  resolverName: string | null;
  decisionHistory: Array<{ id: string; decision: "accepted" | "declined"; rationale: string; decidedAt: string; deciderName: string }>;
  comments: Array<{ id: string; body: string; createdAt: string; authorName: string }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

export function PolicyFeedback({
  policyId,
  threads,
  canManage,
  canCollaborate,
  loadError = false,
}: {
  policyId: string;
  threads: PolicyFeedbackThread[];
  canManage: boolean;
  canCollaborate: boolean;
  loadError?: boolean;
}) {
  return <Card style={{ padding: "18px", marginTop: "16px" }}>
    <h2 style={{ fontSize: "15px", margin: "0 0 6px" }}>Policy feedback</h2>
    <p style={{ color: "#596273", fontSize: "13px", margin: "0 0 16px" }}>Ask for a clarification or suggest a change. Feedback does not edit the approved policy.</p>

    {loadError
      ? <p role="alert" style={{ color: "#8a2c2c", fontSize: "13px" }}>Feedback could not be loaded. Refresh and try again.</p>
      : threads.length === 0
        ? <p style={{ color: "#596273", fontSize: "13px" }}>No feedback has been added to this policy yet.</p>
        : <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
          {threads.map((thread) => <section key={thread.id} style={{ border: "1px solid #e5e9ef", borderRadius: "10px", padding: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "start", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ fontSize: "14px", margin: 0 }}>{thread.subject}</h3>
                <p style={{ color: "#737d8c", fontSize: "12px", margin: "4px 0 0" }}>Feedback on version {thread.policyVersion} · started by {thread.authorName} · {formatDate(thread.createdAt)}</p>
              </div>
              <Pill tone={thread.status === "open" ? "blue" : thread.decision === "accepted" ? "green" : "neutral"}>
                {thread.status === "open" ? "Awaiting decision" : thread.decision === "accepted" ? "Accepted for review" : thread.decision === "declined" ? "Declined" : "Closed previously"}
              </Pill>
            </div>
            <ol style={{ listStyle: "none", margin: "14px 0", padding: 0, display: "grid", gap: "8px" }}>
              {thread.comments.map((comment) => <li key={comment.id} style={{ background: "#f7f9fb", borderRadius: "8px", padding: "10px" }}>
                <p style={{ whiteSpace: "pre-wrap", margin: "0 0 5px", fontSize: "13px" }}>{comment.body}</p>
                <small style={{ color: "#737d8c" }}>{comment.authorName} · {formatDate(comment.createdAt)}</small>
              </li>)}
            </ol>
            {thread.status === "open" && canCollaborate && <form action={replyPolicyFeedbackAction} className="app-form" style={{ marginTop: "10px" }}>
              <input type="hidden" name="threadId" value={thread.id} />
              <label>Reply<textarea name="body" rows={3} required minLength={1} maxLength={4000} /></label>
              <button className="button secondary">Reply</button>
            </form>}
            {thread.status === "open" && canManage && <form action={decidePolicyFeedbackAction} className="app-form" style={{ marginTop: "10px" }}>
              <input type="hidden" name="threadId" value={thread.id} />
              <label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Choose a decision</option><option value="accepted">Accept for policy review</option><option value="declined">Decline suggestion</option></select></label>
              <label>Reason<textarea name="rationale" rows={3} required minLength={1} maxLength={4000} placeholder="Explain the decision to the person who suggested it" /></label>
              <button className="button primary">Save decision</button>
              <p style={{ color: "#596273", fontSize: "12px", margin: 0 }}>Accepting feedback does not change or approve the policy. Make any document change through the normal policy review.</p>
            </form>}
            {canManage && thread.status === "resolved" && <form action={setPolicyFeedbackStatusAction} style={{ marginTop: "10px" }}>
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="resolved" value="false" />
              <button className="button secondary">Reopen feedback</button>
            </form>}
            {thread.status === "resolved" && <p style={{ color: "#596273", fontSize: "12px", margin: "10px 0 0" }}>
              {thread.decision === "accepted" ? "Accepted for review" : thread.decision === "declined" ? "Declined" : "Closed"}{thread.resolverName ? ` by ${thread.resolverName}` : ""}{thread.resolvedAt ? ` · ${formatDate(thread.resolvedAt)}` : ""}
            </p>}
            {thread.decisionRationale && <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: "13px" }}><strong>Reason:</strong> {thread.decisionRationale}</p>}
            {thread.decisionHistory.length > 1 || (thread.status === "open" && thread.decisionHistory.length > 0) ? <details style={{ marginTop: "10px" }}>
              <summary style={{ cursor: "pointer", fontSize: "12px", color: "#596273" }}>Earlier decisions ({thread.decisionHistory.length})</summary>
              <ol style={{ margin: "8px 0 0", paddingLeft: "20px", fontSize: "12px" }}>{thread.decisionHistory.map((entry) => <li key={entry.id} style={{ marginBottom: "8px" }}>
                {entry.decision === "accepted" ? "Accepted for review" : "Declined"} by {entry.deciderName} · {formatDate(entry.decidedAt)}<br />{entry.rationale}
              </li>)}</ol>
            </details> : null}
          </section>)}
        </div>}

    {canCollaborate ? <details>
      <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "var(--blue)" }}>Add feedback</summary>
      <form action={createPolicyFeedbackAction} className="app-form" style={{ paddingTop: "14px" }}>
        <input type="hidden" name="policyId" value={policyId} />
        <label>Subject<input name="subject" required minLength={3} maxLength={160} /></label>
        <label>Comment<textarea name="body" rows={4} required minLength={1} maxLength={4000} /></label>
        <button className="button primary">Start feedback</button>
      </form>
    </details> : <p style={{ color: "#596273", fontSize: "13px", margin: 0 }}>Feedback opens after this policy is approved. Existing threads remain available for operator management.</p>}
  </Card>;
}
