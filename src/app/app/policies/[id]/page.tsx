import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { POLICY_STATUS_LABEL, POLICY_STATUS_TONE, type PolicyStatus } from "@/features/policies/domain/policies";
import { policyAcceptancePresentation, policyPortalAccess } from "@/features/policies/domain/policy-access";
import { Card, PageIntro, Pill, Progress } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { updatePolicyAction, approvePolicyAction, setPolicyStatusAction, acceptPolicyAction } from "../actions";
import { linkPolicyEvidenceAction, unlinkPolicyEvidenceAction } from "./evidence-actions";

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, membership, organisation } = await requireAppContext();
  const access = policyPortalAccess(membership.role);
  const { data: policy } = await supabase.from("policies").select("id,reference,title,body,version,status,review_due,owner_id").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (!policy) notFound();
  const [{ data: acceptances }, { data: members }, { data: links }, { data: evidenceOptions }] = await Promise.all([
    supabase.from("policy_acceptances").select("user_id,accepted_version").eq("policy_id", id).eq("organisation_id", organisation.id),
    access.loadRoster
      ? supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id)
      : Promise.resolve({ data: [] }),
    supabase.from("evidence_links").select("id,evidence(id,title)").eq("policy_id", id).eq("organisation_id", organisation.id),
    access.canManage
      ? supabase.from("evidence").select("id,title").eq("organisation_id", organisation.id).order("title")
      : Promise.resolve({ data: [] }),
  ]);
  const roster = members ?? [];
  const acceptance = policyAcceptancePresentation(membership.role, user.id, policy.version, acceptances ?? [], roster.length);
  const status = policy.status as PolicyStatus;
  const myAcceptance = (acceptances ?? []).find((a) => a.user_id === user.id);
  const acceptedCurrent = myAcceptance?.accepted_version === policy.version;
  const acceptedByUser = new Map((acceptances ?? []).map((a) => [a.user_id, a.accepted_version]));
  return <>
    <Link href="/app/policies" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to policies</Link>
    <PageIntro eyebrow={`POLICY ${policy.reference} · v${policy.version}`} title={policy.title} body={policy.review_due ? `Next review due ${policy.review_due}.` : "No review date set."} action={<Pill tone={POLICY_STATUS_TONE[status]}>{POLICY_STATUS_LABEL[status]}</Pill>} />

    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Acceptance</h2>
      {acceptance.mode === "organisation" && <>
        <Progress value={acceptance.percent} />
        <p style={{ fontSize: "12px", color: "#596273", margin: "8px 0 0" }}>{acceptance.acceptedCurrent} of {acceptance.total} members have accepted version {policy.version} · {acceptance.outstanding} outstanding</p>
      </>}
      {acceptance.mode === "personal" && <p style={{ fontSize: "13px", color: "#596273", margin: 0 }}>Review the current version and record your own acceptance below.</p>}
      {acceptedCurrent
        ? <p style={{ display: "flex", alignItems: "center", gap: "8px", margin: "14px 0 0", fontSize: "13px", color: "#596273" }}>
            <Pill tone="green"><span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><Icon name="check" />Accepted version {policy.version}</span></Pill>
            You have accepted the current version.
          </p>
        : <form action={acceptPolicyAction} style={{ marginTop: "14px" }}>
            <input type="hidden" name="id" value={id} />
            <button className="button primary">I accept this policy</button>
          </form>}
    </Card>

    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Policy content</h2>
      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{policy.body || "No content yet."}</p>
      {access.canManage && <details style={{ marginTop: "16px", borderTop: "1px solid #edf0f4", paddingTop: "14px" }}>
        <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "var(--blue)", display: "flex", alignItems: "center", gap: "6px", width: "fit-content" }}><Icon name="file" />Edit policy</summary>
        <form action={updatePolicyAction} className="app-form" style={{ padding: "16px 0 0" }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="expectedVersion" value={policy.version} />
          <div className="form-grid">
            <label>Reference<input name="reference" required maxLength={40} defaultValue={policy.reference} /></label>
            <label>Title<input name="title" required maxLength={200} defaultValue={policy.title} /></label>
            <label>Review due<input name="reviewDue" type="date" defaultValue={policy.review_due ?? ""} /></label>
          </div>
          <label>Policy content<textarea name="body" maxLength={100000} rows={8} defaultValue={policy.body} /></label>
          <p style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Changing the content bumps the version and asks members to re-accept.</p>
          <button className="button primary">Save changes</button>
        </form>
      </details>}
    </Card>

    {access.canManage && <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Approval</h2>
      {status === "approved"
        ? <p style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0, fontSize: "13px", color: "#596273" }}>
            <Pill tone="green"><span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><Icon name="check" />Approved</span></Pill>
            This policy is approved and published to members.
          </p>
        : <form action={approvePolicyAction}><input type="hidden" name="id" value={id} /><button className="button primary">Approve policy</button></form>}
      <form action={setPolicyStatusAction} style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "14px", borderTop: "1px solid #edf0f4", paddingTop: "14px", flexWrap: "wrap" }}>
        <input type="hidden" name="id" value={id} />
        <label style={{ fontSize: "12px", color: "#596273" }}>Move to
          <select name="status" className="field" defaultValue={status === "approved" ? "draft" : status} aria-label="Policy status" style={{ marginLeft: "8px" }}>{(["draft", "in_review", "archived"] as PolicyStatus[]).map((s) => <option key={s} value={s}>{POLICY_STATUS_LABEL[s]}</option>)}</select>
        </label>
        <button className="button secondary">Set status</button>
      </form>
    </Card>}

    {access.loadRoster && <Card style={{ padding: "18px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Acceptance roster</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
        {roster.map((m) => { const p = one(m.profiles); const v = acceptedByUser.get(m.user_id); const current = v === policy.version; return <li key={m.user_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}><span>{p?.display_name ?? m.user_id}</span>{current ? <Pill tone="green">Accepted v{v}</Pill> : v ? <Pill tone="amber">Re-accept (accepted v{v})</Pill> : <Pill tone="neutral">Not accepted</Pill>}</li>; })}
        {!roster.length && <li style={{ color: "#596273", fontSize: "13px" }}>No members yet.</li>}
      </ul>
    </Card>}

    <Card style={{ padding: "18px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Evidence</h2>
      <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "grid", gap: "6px" }}>
        {(links ?? []).map((l) => { const e = one(l.evidence); return <li key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}><span>{e?.title ?? "Evidence"}</span>{access.canManage && <form action={unlinkPolicyEvidenceAction}><input type="hidden" name="policyId" value={id} /><input type="hidden" name="linkId" value={l.id} /><button aria-label="Remove evidence link" style={{ border: 0, background: "none", color: "#8b94a2" }}>×</button></form>}</li>; })}
        {!links?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No evidence linked yet.</li>}
      </ul>
      {access.canManage && <form action={linkPolicyEvidenceAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input type="hidden" name="policyId" value={id} />
        <select name="evidenceId" className="field" defaultValue="" aria-label="Link evidence to this policy"><option value="" disabled>Link evidence…</option>{evidenceOptions?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
        <button className="button secondary">Link</button>
      </form>}
    </Card>
  </>;
}
