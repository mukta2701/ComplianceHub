import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubTabs } from "@/components/sub-tabs";
import { one } from "@/lib/supabase/one";
import { inviteMemberAction, changeMemberRoleAction, removeMemberAction, resendInvitationAction, revokeInvitationAction, updateMemberJobTitleAction } from "../actions";
import { canInviteRole, canManageMembership, hasCapability, roleLabel, type MembershipRole } from "@/features/organisations/domain/access";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const invitationStatusMessage = {
  sent: "Invitation email sent.",
  failed: "Invitation saved, but email delivery failed. You can retry it below.",
  not_configured: "Invitation saved, but email delivery is not configured. Configure Resend, then retry it below.",
  pending: "Invitation saved and is waiting for delivery.",
} as const;

function deliveryLabel(status: string) {
  if (status === "not_configured") return "Not configured";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ inviteStatus?: string; inviteId?: string }> }) {
  const { supabase, user, membership, organisation } = await requireAppContext();
  const { inviteStatus, inviteId } = await searchParams;
  const isOwner = membership.role === "owner";
  const canManageTeam = hasCapability(membership.role, "manage_members");

  const { data: org } = await supabase.from("organisations").select("slug,created_at").eq("id", organisation.id).maybeSingle();
  const { data: memberRows } = await supabase.from("memberships").select("user_id,role,job_title,created_at,profiles(display_name)").order("created_at", { ascending: true });
  const { data: invites } = canManageTeam
    ? await supabase.from("invitations")
      .select("id,email,role,job_title,expires_at,accepted_at,revoked_at,delivery_status,last_delivery_attempt_at,delivery_attempt_count,created_at")
      .eq("organisation_id", organisation.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
    : { data: null };
  const pendingInvites = invites ?? [];
  const statusMessage = inviteStatus && inviteStatus in invitationStatusMessage
    ? invitationStatusMessage[inviteStatus as keyof typeof invitationStatusMessage]
    : null;

  const created = org?.created_at ? new Date(org.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

  return <>
    <PageIntro eyebrow="SETTINGS" title="Organisation settings" body={`Manage ${organisation.name}, your team and workspace security. Your role: ${roleLabel(membership.role)}.`} />

    <SubTabs tabs={[{ href: "/app/settings", label: "Settings" }, { href: "/app/integrations", label: "Connections" }]} />

    {statusMessage && <Card style={{ padding: "16px", background: "#eef7f0", borderColor: "#cfe6d5", marginBottom: "16px" }} role="status">
      <b>{statusMessage}</b>
      {inviteId && <p style={{ marginTop: "8px", fontSize: "13px" }}>Invitation reference: {inviteId}</p>}
    </Card>}

    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        <a className="active" href="#workspace"><Icon name="settings" />Workspace</a>
        <a href="#team"><Icon name="users" />Team members</a>
        <a href="#security"><Icon name="lock" />Security</a>
      </nav>

      <div className="settings-content">
        <Card id="workspace">
          <div className="settings-head"><h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>Workspace details</h2><p>Basic information shown in your reports and exports.</p></div>
          <dl className="fact-grid" style={{ padding: "20px", gridTemplateColumns: "1fr 1fr" }}>
            <div><dt>Organisation name</dt><dd>{organisation.name}</dd></div>
            <div><dt>Workspace address</dt><dd style={{ wordBreak: "break-all" }}>compliancehub.org/{org?.slug ?? "—"}</dd></div>
            <div><dt>Created</dt><dd>{created}</dd></div>
            <div><dt>Members</dt><dd>{memberRows?.length ?? 0}</dd></div>
          </dl>
        </Card>

        <Card id="team">
          <div className="settings-head"><h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>Team members</h2><p>People with access to this workspace.</p></div>
          <div className="team-list">
            {(memberRows ?? []).map((m) => {
              const p = one(m.profiles);
              const name = p?.display_name ?? "Workspace member";
              const targetRole = m.role as MembershipRole;
              const canManageTarget = canManageMembership(membership.role, targetRole);
              return <div key={m.user_id}>
                <i className="avatar" aria-hidden="true">{initials(name)}</i>
                <span><b>{name}</b><small>{m.user_id === user.id ? "You" : m.job_title || "No job title"}</small></span>
                <Pill tone={m.role === "owner" ? "blue" : m.role === "admin" ? "green" : "neutral"}>{roleLabel(targetRole)}</Pill>
                {canManageTarget && <span className="member-actions">
                  <form action={updateMemberJobTitleAction}>
                    <input type="hidden" name="userId" value={m.user_id} />
                    <input name="jobTitle" defaultValue={m.job_title ?? ""} maxLength={120} placeholder="Job title" aria-label={`Job title for ${name}`} />
                    <button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Save title</button>
                  </form>
                  {isOwner && m.user_id !== user.id && <form action={changeMemberRoleAction}>
                    <input type="hidden" name="userId" value={m.user_id} />
                    <select name="role" defaultValue={m.role} aria-label={`Role for ${name}`}>
                      <option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option>
                    </select>
                    <button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Save role</button>
                  </form>}
                  {m.user_id !== user.id && <form action={removeMemberAction}>
                    <input type="hidden" name="userId" value={m.user_id} />
                    <button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Remove</button>
                  </form>}
                </span>}
              </div>;
            })}
            {!memberRows?.length && <div><span><b>No members yet.</b></span></div>}
          </div>
          {canManageTeam && <form action={inviteMemberAction} className="app-form" style={{ borderTop: "1px solid #edf0f4", maxWidth: "none" }}>
            <div className="form-grid">
              <label>Invite by email<input type="email" name="email" required placeholder="member@example.com" /></label>
              <label>Job title<input name="jobTitle" maxLength={120} placeholder="Developer, CTO, Employee…" /></label>
              <label>Role<select name="role"><option value="member">Member</option>{isOwner && <option value="admin">Admin</option>}</select></label>
            </div>
            <button className="button primary" style={{ justifySelf: "start" }}><Icon name="plus" />Create invite</button>
          </form>}
        </Card>

        {canManageTeam && !!pendingInvites.length && <Card id="invites">
          <div className="settings-head"><h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>Pending invitations</h2><p>Active invitations stay here until accepted or revoked. Failed or unconfigured delivery can be retried.</p></div>
          <div className="team-list">
            {pendingInvites.map((i) => <div key={i.id}>
              <i className="avatar" aria-hidden="true"><Icon name="bell" /></i>
              <span><b>{i.email}</b><small>{i.job_title ? `${i.job_title} · ` : ""}Expires {new Date(i.expires_at).toLocaleDateString("en-GB")}</small></span>
              <Pill tone={i.role === "admin" ? "green" : "neutral"}>{roleLabel(i.role as MembershipRole)}</Pill>
              <Pill tone={i.delivery_status === "sent" ? "green" : "amber"}>{deliveryLabel(i.delivery_status)}</Pill>
              {canInviteRole(membership.role, i.role as MembershipRole) && <span className="member-actions">
                <form action={resendInvitationAction}><input type="hidden" name="invitationId" value={i.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>{i.delivery_status === "sent" ? "Resend" : "Retry"}</button></form>
                <form action={revokeInvitationAction}><input type="hidden" name="invitationId" value={i.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Revoke</button></form>
              </span>}
            </div>)}
          </div>
        </Card>}

        <Card id="security" className="security-card">
          <div className="settings-head"><h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>Security &amp; data</h2><p>How ComplianceHub protects this workspace.</p></div>
          <div className="security-row"><Icon name="lock" /><span><b>Row-level access controls</b><small>Your organisation&rsquo;s data is isolated at the database layer, so members only ever see this workspace.</small></span><Pill tone="green">Enabled</Pill></div>
          <div className="security-row"><Icon name="file" /><span><b>Audit trail</b><small>Important changes are recorded on the Activity page without storing sensitive evidence content.</small></span><Pill tone="green">Enabled</Pill></div>
        </Card>
      </div>
    </div>
  </>;
}
