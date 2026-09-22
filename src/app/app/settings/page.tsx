import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubTabs } from "@/components/sub-tabs";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";
import { one } from "@/lib/supabase/one";
import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction, updateMemberJobTitleAction } from "../actions";
import { canInviteRole, canManageMembership, roleLabel, type MembershipRole } from "@/features/organisations/domain/access";
import { SettingsSections } from "./settings-sections";
import { InvitationForm } from "./invitation-form";
import styles from "./settings-sections.module.css";

const connectionsMetadata = workspaceAccess("owner").section("connections");

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default async function SettingsPage() {
  const { supabase, user, membership, organisation } = await requireAppContext();
  const settingsAccess = workspaceAccess(membership.role).section("settings");
  const isOwner = settingsAccess.canManageOperation("change-member-role");
  const canManageTeam = settingsAccess.canManage;

  const { data: org } = await supabase.from("organisations").select("slug,created_at").eq("id", organisation.id).maybeSingle();
  const { data: memberRows } = await supabase.from("memberships").select("user_id,role,job_title,created_at,profiles(display_name)").eq("organisation_id", organisation.id).order("created_at", { ascending: true });
  const { data: invites } = canManageTeam
    ? await supabase.from("invitations")
      .select("id,email,role,job_title,expires_at,accepted_at,revoked_at,delivery_status,last_delivery_attempt_at,delivery_attempt_count,created_at")
      .eq("organisation_id", organisation.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
    : { data: null };
  const pendingInvites = invites ?? [];
  const created = org?.created_at ? new Date(org.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

  const workspace = (
    <Card className={styles.card}>
      <div className={styles.sectionHeader}>
        <h2>Workspace details</h2>
        <p>Basic information shown in your reports and exports.</p>
      </div>
      <dl className={styles.factGrid}>
        <div><dt>Organisation name</dt><dd>{organisation.name}</dd></div>
        <div><dt>Workspace address</dt><dd>compliancehub.org/{org?.slug ?? "—"}</dd></div>
        <div><dt>Created</dt><dd>{created}</dd></div>
        <div><dt>Members</dt><dd>{memberRows?.length ?? 0}</dd></div>
      </dl>
    </Card>
  );

  const team = (
    <Card className={styles.card}>
      <div className={styles.sectionHeader}>
        <h2>Team members</h2>
        <p>People with access to this workspace. Their role controls what they can change.</p>
      </div>
      <div className={styles.memberList}>
        {(memberRows ?? []).map((member) => {
          const profile = one(member.profiles);
          const name = profile?.display_name ?? "Workspace member";
          const targetRole = member.role as MembershipRole;
          const canManageTarget = canManageMembership(membership.role, targetRole);
          return (
            <div className={styles.memberRow} key={member.user_id}>
              <i className={styles.avatar} aria-hidden="true">{initials(name)}</i>
              <span className={styles.memberIdentity}>
                <b>{name}</b>
                <small>{member.user_id === user.id ? "You" : member.job_title || "No job title"}</small>
              </span>
              <Pill tone={member.role === "owner" ? "blue" : member.role === "admin" ? "green" : "neutral"}>{roleLabel(targetRole)}</Pill>
              {canManageTarget && (
                <details className={styles.memberDetails}>
                  <summary>Edit details</summary>
                  <div className={styles.memberEditor}>
                    <form action={updateMemberJobTitleAction}>
                      <input type="hidden" name="userId" value={member.user_id} />
                      <label>
                        Job title
                        <input className={styles.field} name="jobTitle" defaultValue={member.job_title ?? ""} maxLength={120} placeholder="Job title" />
                      </label>
                      <button className={`button secondary ${styles.smallButton}`}>Save title</button>
                    </form>
                    {isOwner && member.user_id !== user.id && (
                      <form action={changeMemberRoleAction}>
                        <input type="hidden" name="userId" value={member.user_id} />
                        <label>
                          Role
                          <select className={styles.field} name="role" defaultValue={member.role}>
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="owner">Owner</option>
                          </select>
                        </label>
                        <button className={`button secondary ${styles.smallButton}`}>Save role</button>
                      </form>
                    )}
                    {member.user_id !== user.id && (
                      <form action={removeMemberAction}>
                        <input type="hidden" name="userId" value={member.user_id} />
                        <button className={`button secondary ${styles.smallButton}`}>Remove</button>
                      </form>
                    )}
                  </div>
                </details>
              )}
            </div>
          );
        })}
        {!memberRows?.length && <div className={styles.memberRow}><span className={styles.memberIdentity}><b>No members yet.</b></span></div>}
      </div>

      {canManageTeam && pendingInvites.length > 0 && (
        <section className={styles.invitationArea} id="invites">
          <div className={styles.invitationHeader}>
            <h3>Pending invitations</h3>
            <p className={styles.sectionNote}>Links are shown only when created. Create another invitation for the same email to replace a lost or expired link.</p>
          </div>
          <div className={styles.invitationList}>
            {pendingInvites.map((invitation) => (
              <div className={styles.invitationRow} key={invitation.id}>
                <i className={styles.avatar} aria-hidden="true"><Icon name="bell" /></i>
                <span className={styles.invitationIdentity}>
                  <b>{invitation.email}</b>
                  <small>{invitation.job_title ? `${invitation.job_title} · ` : ""}Expires {new Date(invitation.expires_at).toLocaleDateString("en-GB")}</small>
                </span>
                <Pill tone={invitation.role === "admin" ? "green" : "neutral"}>{roleLabel(invitation.role as MembershipRole)}</Pill>
                <Pill tone="amber">Awaiting acceptance</Pill>
                {canInviteRole(membership.role, invitation.role as MembershipRole) && <>
                  <form action={revokeInvitationAction}><input type="hidden" name="invitationId" value={invitation.id} /><button className={`button secondary ${styles.smallButton}`}>Revoke</button></form>
                </>}
              </div>
            ))}
          </div>
        </section>
      )}

      {canManageTeam && (
        <InvitationForm key={organisation.id} canInviteAdmin={isOwner} />
      )}
    </Card>
  );

  const security = (
    <Card className={styles.card}>
      <div className={styles.sectionHeader}><h2>Security &amp; data</h2><p>How ComplianceHub protects this workspace.</p></div>
      <div className={styles.securityRow}><Icon name="lock" /><span className={styles.securityCopy}><b>Row-level access controls</b><small>Your organisation&rsquo;s data is isolated at the database layer, so members only ever see this workspace.</small></span><Pill tone="green">Enabled</Pill></div>
      <div className={styles.securityRow}><Icon name="file" /><span className={styles.securityCopy}><b>Audit trail</b><small>Important changes are recorded on the Activity page without storing sensitive evidence content.</small></span><Pill tone="green">Enabled</Pill></div>
    </Card>
  );

  const customerTrust = (
    <Card className={styles.card}>
      <div className={styles.sectionHeader}>
        <h2>Customer trust</h2>
        <p>Share an optional, customer-facing security summary. It stays private until an Owner or Admin publishes it.</p>
      </div>
      <div className={styles.integratedSection}>
        <p>Choose exactly what prospects can see. Risks, findings, evidence files and policy contents remain private.</p>
        <Link className="button secondary" href="/app/trust">Manage Trust Center</Link>
      </div>
    </Card>
  );

  return <>
    <PageIntro eyebrow="SETTINGS" title="Organisation settings" body={`Manage ${organisation.name}, your team and workspace security. Your role: ${roleLabel(membership.role)}.`} />
    <SubTabs tabs={[
      { href: "/app/settings", label: "Settings" },
      { href: connectionsMetadata.href, label: connectionsMetadata.label },
    ]} />
    <SettingsSections
      initialSection="team"
      workspace={workspace}
      team={team}
      security={security}
      customerTrust={customerTrust}
    />
  </>;
}
import Link from "next/link";
