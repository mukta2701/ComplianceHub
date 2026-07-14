import { Card, Pill } from "@/components/ui";
import {
  createPolicyFeedbackAction,
  replyPolicyFeedbackAction,
  setPolicyFeedbackStatusAction,
} from "@/app/app/policies/[id]/feedback-actions";

export type PolicyFeedbackThread = {
  id: string;
  subject: string;
  status: "open" | "resolved";
  policyVersion: number;
  createdAt: string;
  resolvedAt: string | null;
  authorName: string;
  resolverName: string | null;
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
              <Pill tone={thread.status === "open" ? "blue" : "green"}>{thread.status === "open" ? "Open" : "Resolved"}</Pill>
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
            {canManage && <form action={setPolicyFeedbackStatusAction} style={{ marginTop: "10px" }}>
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="resolved" value={thread.status === "open" ? "true" : "false"} />
              <button className="button secondary">{thread.status === "open" ? "Resolve" : "Reopen"}</button>
            </form>}
            {thread.status === "resolved" && <p style={{ color: "#596273", fontSize: "12px", margin: "10px 0 0" }}>
              Resolved{thread.resolverName ? ` by ${thread.resolverName}` : ""}{thread.resolvedAt ? ` · ${formatDate(thread.resolvedAt)}` : ""}
            </p>}
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
