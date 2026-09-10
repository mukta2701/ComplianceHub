import { loadPolicyRows } from "../policy-query";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { POLICY_STATUS_LABEL, POLICY_STATUS_TONE, type PolicyStatus } from "@/features/policies/domain/policies";
import { policyAcceptancePresentation, policyPortalAccess } from "@/features/policies/domain/policy-access";
import { Card, PageIntro, Pill, Progress } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { linkPolicyEvidenceAction, unlinkPolicyEvidenceAction } from "./evidence-actions";
import styles from "../policy-workspace.module.css";
import { PolicyEditForm } from "../policy-edit-form";
import { PolicyFeedback, type PolicyFeedbackThread } from "@/features/policies/components/policy-feedback";
import { PolicyAcceptanceForm, PolicyApproveForm, PolicyStatusForm } from "../policy-decision-forms";

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, membership, organisation } = await requireAppContext();
  const access = policyPortalAccess(membership.role);
  const { data: policy, error: policyError } = await supabase.from("policies").select("id,reference,title,body,version,status,review_due,owner_id,edit_revision").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (policyError) return <Card><h2>Policy unavailable</h2><p>We could not load this policy. Your records have not changed.</p><Link href="/app/policies">Back to policies</Link></Card>;
  if (!policy) notFound();
  const [acceptanceResult, memberResult, linkResult, optionResult, feedbackResult, commentResult, reviewTaskResult] = await Promise.all([
    loadPolicyRows((from, to) => supabase.from("policy_acceptances").select("user_id,accepted_version").eq("policy_id", id).eq("organisation_id", organisation.id).order("id").range(from, to)),
    access.loadRoster
      ? loadPolicyRows((from, to) => supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id).order("user_id").range(from, to))
      : Promise.resolve({ data: [], error: null }),
    loadPolicyRows((from, to) => supabase.from("evidence_links").select("id,evidence(id,title,status)").eq("policy_id", id).eq("organisation_id", organisation.id).order("id").range(from, to)),
    access.canManage
      ? loadPolicyRows((from, to) => supabase.from("evidence").select("id,title").eq("organisation_id", organisation.id).order("id").range(from, to))
      : Promise.resolve({ data: [], error: null }),
    loadPolicyRows((from, to) => supabase.from("policy_feedback_threads")
      .select("id,subject,status,policy_version,created_at,resolved_at,author:profiles!policy_feedback_threads_author_id_fkey(display_name),resolver:profiles!policy_feedback_threads_resolved_by_fkey(display_name)")
      .eq("policy_id", id).eq("organisation_id", organisation.id)
      .order("id").range(from, to)),
    loadPolicyRows((from, to) => supabase.from("policy_feedback_comments").select("id,thread_id,body,created_at,author:profiles!policy_feedback_comments_author_id_fkey(display_name),thread:policy_feedback_threads!inner(policy_id)").eq("organisation_id", organisation.id).eq("thread.policy_id", id).order("id").range(from, to)),
    access.canManage
      ? loadPolicyRows((from, to) => supabase.from("tasks").select("id,title,status,due_on,owner_id,policy_review_due_on").eq("organisation_id", organisation.id).eq("policy_id", id).eq("source", "policy_review").order("id").range(from, to))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const { data: acceptances } = acceptanceResult;
  const { data: members } = memberResult;
  const { data: links } = linkResult;
  const { data: evidenceOptions } = optionResult;
  const roster = members ?? [];
  const acceptanceUnavailable = Boolean(acceptanceResult.error || memberResult.error);
  const acceptance = policyAcceptancePresentation(membership.role, user.id, policy.version, acceptances ?? [], roster.length);
  const status = policy.status as PolicyStatus;
  const myAcceptance = (acceptances ?? []).find((a) => a.user_id === user.id);
  const acceptedCurrent = myAcceptance?.accepted_version === policy.version;
  const acceptedByUser = new Map((acceptances ?? []).map((a) => [a.user_id, a.accepted_version]));
  const feedbackThreads: PolicyFeedbackThread[] = ([...(feedbackResult.data ?? [])] as Array<Record<string, unknown>>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id))).map((thread) => {
    const author = one(thread.author as { display_name: string | null } | Array<{ display_name: string | null }> | null);
    const resolver = one(thread.resolver as { display_name: string | null } | Array<{ display_name: string | null }> | null);
    const comments = [...((commentResult.data ?? []).filter((comment) => comment.thread_id === thread.id) as Array<Record<string, unknown>>)].sort((left, right) => {
      const time = String(left.created_at).localeCompare(String(right.created_at));
      return time || String(left.id).localeCompare(String(right.id));
    });
    return {
      id: String(thread.id), subject: String(thread.subject), status: thread.status === "resolved" ? "resolved" : "open",
      policyVersion: Number(thread.policy_version), createdAt: String(thread.created_at), resolvedAt: thread.resolved_at ? String(thread.resolved_at) : null,
      authorName: author?.display_name?.trim() || "Workspace member", resolverName: resolver?.display_name?.trim() || null,
      comments: comments.map((comment) => {
        const commentAuthor = one(comment.author as { display_name: string | null } | Array<{ display_name: string | null }> | null);
        return { id: String(comment.id), body: String(comment.body), createdAt: String(comment.created_at), authorName: commentAuthor?.display_name?.trim() || "Workspace member" };
      }),
    };
  });
  const owner = roster.find((member) => member.user_id === policy.owner_id);
  const linkedEvidence = new Set((links ?? []).map((link) => one(link.evidence)?.id));
  const availableEvidence = (evidenceOptions ?? []).filter((item) => !linkedEvidence.has(item.id));
  return <div className={styles.workspace}>
    <Link href="/app/policies" className={styles.back}>← Back to policies</Link>
    <PageIntro eyebrow={`POLICY ${policy.reference} · v${policy.version}`} title={policy.title} body="Read the current document, follow its review, and keep acceptance separate from approval." action={<Pill tone={POLICY_STATUS_TONE[status]}>{POLICY_STATUS_LABEL[status]}</Pill>} />
    <div className={styles.documentGrid}>
      <div className={styles.documentColumn}>
        <Card className={styles.document}>
          <header className={styles.documentHeader}><h2>Policy content</h2><span>Version {policy.version}</span></header>
          <div className={styles.documentBody}>{policy.body || "No content yet."}</div>
          {access.canManage && <details className={styles.disclosure}>
            <summary><Icon name="file" />Edit policy</summary>
            <PolicyEditForm policy={{ id, reference: policy.reference, title: policy.title, body: policy.body, version: policy.version, revision: policy.edit_revision, ownerId: policy.owner_id, reviewDue: policy.review_due }} owners={roster.map((member) => ({ id: member.user_id, name: one(member.profiles)?.display_name || "Workspace member" }))} />
          </details>}
        </Card>
        <Card className={styles.panel}>
          <h2>Acceptance</h2>
          <p className={styles.help}>Acceptance records that a person has read this version. It is separate from approving the policy or verifying safeguards.</p>
          {acceptanceUnavailable ? <p role="alert">Acceptance information is unavailable. Refresh before recording a decision.</p> : <>
            {acceptance.mode === "organisation" && status === "approved" && <>
              <Progress value={acceptance.percent} />
              <p className={styles.help}>{acceptance.acceptedCurrent} of {acceptance.total} members have accepted version {policy.version} · {acceptance.outstanding} outstanding</p>
            </>}
            {acceptance.mode === "personal" && status === "approved" && !acceptedCurrent && <p className={styles.help}>Review the current version and record your own acceptance below.</p>}
            {status !== "approved" && <p className={styles.notice}>Personal acceptance is available only while this policy is approved. Previous acceptances remain on record.</p>}
            {acceptedCurrent ? <div className={styles.accepted}><Pill tone="green">Accepted version {policy.version}</Pill><p className={styles.help}>{status === "approved" ? "You have accepted the current version." : "Your earlier acceptance is preserved; this policy is not currently approved."}</p></div>
              : status === "approved" ? <PolicyAcceptanceForm id={id} version={policy.version} /> : null}
          </>}
        </Card>
      </div>
      <aside className={styles.sidebar} aria-label="Policy lifecycle and accountability">
        <Card className={styles.panel}>
          <h2>Policy lifecycle</h2>
          <p className={styles.help}>{status === "approved" ? "Published for members to read and accept." : status === "in_review" ? "In review. Acceptance opens after approval." : status === "archived" ? "Archived. Previous records are retained." : "Draft. Prepare the document before approval."}</p>
          <dl className={styles.facts}>
            <div><dt>Current status</dt><dd>{POLICY_STATUS_LABEL[status]}</dd></div>
            <div><dt>Version</dt><dd>{policy.version}</dd></div>
            <div><dt>Policy owner</dt><dd>{memberResult.error ? "Unavailable" : policy.owner_id ? one(owner?.profiles)?.display_name || "Assigned member" : "Unassigned"}</dd></div>
            <div><dt>Next review</dt><dd>{policy.review_due || "Not scheduled"}</dd></div>
          </dl>
        </Card>
        {access.canManage && <Card className={styles.panel}>
          <h2>Approval</h2>
          <p className={styles.help}>{status === "approved" ? "This policy is approved and published to members." : "Review the document and ownership before publishing it to workspace members."}</p>
          {status !== "approved" && <PolicyApproveForm id={id} version={policy.version} revision={policy.edit_revision} />}
          <details className={styles.disclosure}><summary>Change lifecycle status</summary>
            <p className={styles.help}>Moving away from Approved closes new acceptance and feedback. Earlier records stay available.</p>
            <PolicyStatusForm id={id} version={policy.version} revision={policy.edit_revision} />
          </details>
        </Card>}
      </aside>
    </div>
    <div className={styles.relatedGrid}>
      {access.loadRoster && <Card className={styles.panel}>
        <h2>Acceptance roster</h2>
        <p className={styles.help}>{status === "approved" ? `Acceptance of version ${policy.version} by current workspace members.` : "Historical acceptance records. New acceptance is not open."}</p>
        {acceptanceUnavailable ? <p role="alert">The acceptance roster could not be loaded.</p> : <ul className={styles.list}>
          {roster.map((m) => { const p = one(m.profiles); const v = acceptedByUser.get(m.user_id); const current = v === policy.version; return <li key={m.user_id}><span>{p?.display_name || "Workspace member"}</span>{current ? <Pill tone="green">Accepted v{v}</Pill> : v ? <Pill tone="amber">{status === "approved" ? "Re-accept" : "Previously accepted"} (accepted v{v})</Pill> : <Pill tone="neutral">{status === "approved" ? "Not accepted" : "No acceptance recorded"}</Pill>}</li>; })}
          {!roster.length && <li>No members yet.</li>}
        </ul>}
      </Card>}
      <Card className={styles.panel}>
        <h2>Evidence</h2><p className={styles.help}>Open the supporting record to inspect its source. Freshness is separate from human review.</p>
        {linkResult.error ? <p role="alert">Linked evidence could not be loaded.</p> : <ul className={styles.list}>
          {(links ?? []).map((l) => { const e = one(l.evidence); return <li key={l.id}><div>{e ? <>{access.canManage ? <Link href={`/app/evidence?evidence=${e.id}#evidence-${e.id}`}>{e.title}</Link> : <span>{e.title}</span>}<small>Freshness: {e.status || "Unknown"}</small></> : <span>Linked evidence unavailable.</span>}</div>{access.canManage && <form action={unlinkPolicyEvidenceAction}><input type="hidden" name="policyId" value={id} /><input type="hidden" name="linkId" value={l.id} /><button className={styles.remove} aria-label="Remove evidence link">Remove</button></form>}</li>; })}
          {!links?.length && <li>No evidence linked yet.</li>}
        </ul>}
        {access.canManage && (optionResult.error ? <p role="alert">Evidence choices could not be loaded.</p> : availableEvidence.length ? <form action={linkPolicyEvidenceAction} className={styles.linkForm}>
          <input type="hidden" name="policyId" value={id} />
          <label>Link evidence<select name="evidenceId" className="field" required defaultValue="" aria-label="Link evidence to this policy"><option value="" disabled>Select evidence</option>{availableEvidence.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
          <button className="button secondary">Link</button>
        </form> : <p className={styles.help}>{evidenceOptions?.length ? "All available evidence is already linked." : "No evidence is available to link yet."} <Link href="/app/evidence">Open evidence library</Link></p>)}
      </Card>
      {access.canManage && <Card className={styles.panel}>
        <h2>Policy review work</h2><p className={styles.help}>Recurring tasks coordinate the human review. Completing a task does not approve, renew or change this policy.</p>
        {reviewTaskResult.error ? <p role="alert">Policy review tasks could not be loaded.</p> : <ul className={styles.list}>
          {(reviewTaskResult.data ?? []).map((task) => { const taskOwner = roster.find((member) => member.user_id === task.owner_id); return <li key={task.id}><div><Link href={`/app/tasks/${task.id}`}>{task.title}</Link><small>{task.due_on ? `Due ${task.due_on}` : "No due date"}{task.policy_review_due_on ? ` · Review cycle ${task.policy_review_due_on}` : ""} · {task.owner_id ? one(taskOwner?.profiles)?.display_name || "Assigned member" : "Unassigned"}</small></div><Pill tone={task.status === "done" ? "green" : task.status === "in_progress" ? "blue" : task.status === "cancelled" ? "neutral" : "amber"}>{task.status.replaceAll("_", " ")}</Pill></li>; })}
          {!reviewTaskResult.data?.length && <li>No recurring policy review task has been raised yet.</li>}
        </ul>}
      </Card>}
    </div>
    <PolicyFeedback policyId={id} threads={feedbackThreads} canManage={access.canManage} canCollaborate={status === "approved"} loadError={Boolean(feedbackResult.error || commentResult.error)} />
  </div>;
}
