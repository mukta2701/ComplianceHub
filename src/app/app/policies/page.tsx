import { loadPolicyRows } from "./policy-query";
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { POLICY_STATUS_LABEL, POLICY_STATUS_TONE, type PolicyStatus } from "@/features/policies/domain/policies";
import { policyAcceptancePresentation, policyPortalAccess } from "@/features/policies/domain/policy-access";
import { Card, PageIntro, Pill } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import styles from "./policy-workspace.module.css";
import { Icon } from "@/components/icons";

export default async function PoliciesPage() {
  const { supabase, user, membership, organisation } = await requireAppContext();
  const access = policyPortalAccess(membership.role);
  const [policyResult, acceptanceResult, memberResult] = await Promise.all([
    loadPolicyRows((from, to) => supabase.from("policies").select("id,reference,title,status,version,review_due,owner_id").eq("organisation_id", organisation.id).order("id").range(from, to)),
    loadPolicyRows((from, to) => supabase.from("policy_acceptances").select("policy_id,user_id,accepted_version").eq("organisation_id", organisation.id).order("id").range(from, to)),
    access.loadRoster
      ? loadPolicyRows((from, to) => supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id).order("user_id").range(from, to))
      : Promise.resolve({ count: 0, data: [], error: null }),
  ]);
  const { data: policies } = policyResult;
  const { data: acceptances } = acceptanceResult;
  const memberCount = memberResult.data?.length;
  const acceptanceUnavailable = Boolean(acceptanceResult.error || memberResult.error);
  const rows = [...(policies ?? [])].sort((a, b) => a.reference.localeCompare(b.reference));
  const members = memberCount ?? 0;
  const approved = rows.filter((p) => p.status === "approved").length;
  const byPolicy = new Map<string, { user_id: string; accepted_version: number }[]>();
  for (const a of acceptances ?? []) byPolicy.set(a.policy_id, [...(byPolicy.get(a.policy_id) ?? []), { user_id: a.user_id, accepted_version: a.accepted_version }]);
  const personallyAccepted = rows.filter((policy) => {
    const presentation = policyAcceptancePresentation(membership.role, user.id, policy.version, byPolicy.get(policy.id) ?? [], members);
    return presentation.mode === "personal" && presentation.acceptedCurrent;
  }).length;
  const emptyMessage = access.canManage
    ? "No policies yet. Author your first policy to start tracking acceptance."
    : "No approved policies are available yet.";
  const today = new Date().toISOString().slice(0, 10);
  const overdue = rows.filter((p) => p.status !== "archived" && p.review_due && p.review_due < today).length;
  const ownerName = (ownerId: string | null) => !ownerId ? "Unassigned" : memberResult.error ? "Unavailable" : one((memberResult.data ?? []).find((member) => member.user_id === ownerId)?.profiles)?.display_name || "Assigned member";
  const acceptanceText = (p: typeof rows[number]) => {
    if (p.status !== "approved") return "Not open for acceptance";
    if (acceptanceUnavailable) return "Acceptance unavailable";
    const a = policyAcceptancePresentation(membership.role, user.id, p.version, byPolicy.get(p.id) ?? [], members);
    return a.mode === "organisation" ? `${a.acceptedCurrent}/${a.total} (${a.percent}%)` : a.acceptedCurrent ? "Accepted" : "Not accepted";
  };
  return <div className={styles.workspace}>
    <PageIntro eyebrow="POLICIES" title="Policy library" body={access.canManage ? "Keep policies owned, reviewed and understood. Approval and employee acceptance are separate steps." : "Read your organisation's approved policies and record your own acceptance."} action={access.canManage ? <Link className="button primary" href="/app/policies/new"><Icon name="plus" />New policy</Link> : undefined} />
    {policyResult.error ? <Card className={styles.panel}><h2>Policy library unavailable</h2><p role="alert">We could not load your policies. Refresh to try again; this does not mean the library is empty.</p></Card> : <>
      <div className={styles.summaryGrid}>
        <div className={styles.summary}><span>Total policies</span><strong>{rows.length}</strong></div>
        <div className={styles.summary}><span>Approved</span><strong>{approved}</strong></div>
        <div className={styles.summary}><span>Reviews overdue</span><strong>{overdue}</strong></div>
        <div className={styles.summary}><span>{access.showOrganisationProgress ? "In review" : "My acceptances"}</span><strong>{access.showOrganisationProgress ? rows.filter((p) => p.status === "in_review").length : acceptanceUnavailable ? "Unavailable" : personallyAccepted}</strong></div>
      </div>
      <Card className={styles.register}>
        <header className={styles.registerHeader}><div><h2>All policies</h2><p>{access.showOrganisationProgress ? "Ownership, review dates and acceptance of the current approved version." : "Your acceptance is specific to the version you read."}</p></div></header>
        {!rows.length ? <p className={styles.empty}>{emptyMessage}</p> : <>
          <div className={styles.desktopTable}><table className={styles.table} aria-label="Policy library table">
            <thead><tr><th>Policy</th><th>Status / version</th><th>Owner</th><th>Next review</th><th>{access.showOrganisationProgress ? "Organisation acceptance" : "My acceptance"}</th></tr></thead>
            <tbody>{rows.map((p) => <tr key={p.id}><td><Link href={`/app/policies/${p.id}`}>{p.title}</Link><small>{p.reference}</small></td><td><Pill tone={POLICY_STATUS_TONE[p.status as PolicyStatus]}>{POLICY_STATUS_LABEL[p.status as PolicyStatus]}</Pill><small>Version {p.version}</small></td><td>{ownerName(p.owner_id)}</td><td>{p.review_due || "Not scheduled"}{p.status !== "archived" && p.review_due && p.review_due < today && <small>Overdue</small>}</td><td>{acceptanceText(p)}</td></tr>)}</tbody>
          </table></div>
          <ul className={styles.mobileList} aria-label="Policy cards">{rows.map((p) => <li className={styles.mobileItem} key={p.id}>
            <div className={styles.mobileTop}><Link href={`/app/policies/${p.id}`}><small>{p.reference} · v{p.version}</small><strong>{p.title}</strong></Link><Pill tone={POLICY_STATUS_TONE[p.status as PolicyStatus]}>{POLICY_STATUS_LABEL[p.status as PolicyStatus]}</Pill></div>
            <dl className={styles.facts}><div><dt>Policy owner</dt><dd>{ownerName(p.owner_id)}</dd></div><div><dt>Next review</dt><dd>{p.review_due || "Not scheduled"}{p.status !== "archived" && p.review_due && p.review_due < today && " · Overdue"}</dd></div><div><dt>{access.showOrganisationProgress ? "Organisation acceptance" : "My acceptance"}</dt><dd>{acceptanceText(p)}</dd></div></dl>
          </li>)}</ul>
        </>}
      </Card>
    </>}
  </div>;
}
