import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { POLICY_STATUS_LABEL, POLICY_STATUS_TONE, type PolicyStatus } from "@/features/policies/domain/policies";
import { policyAcceptancePresentation, policyPortalAccess } from "@/features/policies/domain/policy-access";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function PoliciesPage() {
  const { supabase, user, membership } = await requireAppContext();
  const access = policyPortalAccess(membership.role);
  const [{ data: policies }, { data: acceptances }, { count: memberCount }] = await Promise.all([
    supabase.from("policies").select("id,reference,title,status,version,review_due").order("reference"),
    supabase.from("policy_acceptances").select("policy_id,user_id,accepted_version"),
    access.loadRoster
      ? supabase.from("memberships").select("user_id", { count: "exact", head: true })
      : Promise.resolve({ count: 0 }),
  ]);
  const rows = policies ?? [];
  const members = memberCount ?? 0;
  const approved = rows.filter((p) => p.status === "approved").length;
  const byPolicy = new Map<string, { user_id: string; accepted_version: number }[]>();
  for (const a of acceptances ?? []) byPolicy.set(a.policy_id, [...(byPolicy.get(a.policy_id) ?? []), { user_id: a.user_id, accepted_version: a.accepted_version }]);
  const personallyAccepted = rows.filter((policy) => {
    const presentation = policyAcceptancePresentation(membership.role, user.id, policy.version, byPolicy.get(policy.id) ?? [], members);
    return presentation.mode === "personal" && presentation.acceptedCurrent;
  }).length;
  return <>
    <PageIntro eyebrow="POLICIES" title="Policy library" body={access.canManage ? "Author policies, approve them, and track who has accepted the current version." : "Read your organisation's approved policies and record your own acceptance."} action={access.canManage ? <Link className="button primary" href="/app/policies/new"><Icon name="plus" />New policy</Link> : undefined} />
    <div className="stats-grid">
      <Stat label="POLICIES" value={rows.length} detail="in the library" />
      <Stat label="APPROVED" value={approved} detail="published to members" tone="green" />
      {access.showOrganisationProgress
        ? <Stat label="MEMBERS" value={members} detail="in this workspace" />
        : <Stat label="MY ACCEPTANCES" value={personallyAccepted} detail="current versions accepted" tone="green" />}
    </div>
    <Card style={{ padding: 0 }}><div className="data-table-wrap" role="region" aria-label="Policy library table" tabIndex={0}><table>
      <thead><tr><th>Ref</th><th>Policy</th><th>Status</th><th>Version</th><th>{access.showOrganisationProgress ? "Organisation acceptance" : "My acceptance"}</th></tr></thead>
      <tbody>
        {rows.map((p) => {
          const acceptance = policyAcceptancePresentation(membership.role, user.id, p.version, byPolicy.get(p.id) ?? [], members);
          return <tr key={p.id}>
            <td>{p.reference}</td>
            <td><Link href={`/app/policies/${p.id}`}><b>{p.title}</b></Link></td>
            <td><Pill tone={POLICY_STATUS_TONE[p.status as PolicyStatus]}>{POLICY_STATUS_LABEL[p.status as PolicyStatus]}</Pill></td>
            <td>v{p.version}</td>
            <td>{acceptance.mode === "organisation"
              ? `${acceptance.acceptedCurrent}/${acceptance.total} (${acceptance.percent}%)`
              : acceptance.acceptedCurrent ? "Accepted" : "Not accepted"}</td>
          </tr>;
        })}
        {!rows.length && <tr><td colSpan={5} style={{ color: "#596273" }}>No policies yet. Author your first policy to start tracking acceptance.</td></tr>}
      </tbody>
    </table></div></Card>
  </>;
}
