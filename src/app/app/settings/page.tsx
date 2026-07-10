import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubTabs } from "@/components/sub-tabs";
import { one } from "@/lib/supabase/one";
import { inviteMemberAction } from "../actions";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { supabase, membership, organisation } = await requireAppContext();
  const { invite } = await searchParams;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const isOwner = membership.role === "owner";

  const { data: org } = await supabase.from("organisations").select("slug,created_at").eq("id", organisation.id).maybeSingle();
  const { data: memberRows } = await supabase.from("memberships").select("user_id,role,created_at,profiles(display_name)").order("created_at", { ascending: true });
  const { data: invites } = isOwner
    ? await supabase.from("invitations").select("email,role,expires_at,accepted_at,created_at").order("created_at", { ascending: false })
    : { data: null };
  const pendingInvites = (invites ?? []).filter((i) => !i.accepted_at);

  const created = org?.created_at ? new Date(org.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

  return <>
    <PageIntro eyebrow="SETTINGS" title="Organisation settings" body={`Manage ${organisation.name}, your team and workspace security. Your role: ${membership.role === "owner" ? "Owner" : "Member"}.`} />

    <SubTabs tabs={[{ href: "/app/settings", label: "Settings" }, { href: "/app/integrations", label: "Connections" }]} />

    {invite && <Card style={{ padding: "16px", background: "#eef7f0", borderColor: "#cfe6d5", marginBottom: "16px" }} role="status">
      <b>Invitation created.</b>
      <p style={{ marginTop: "8px", wordBreak: "break-all", fontSize: "13px" }}>{site}/app/invitations/accept?token={invite}</p>
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
              return <div key={m.user_id}>
                <i className="avatar" aria-hidden="true">{initials(name)}</i>
                <span><b>{name}</b></span>
                <Pill tone={m.role === "owner" ? "blue" : "neutral"}>{m.role === "owner" ? "Owner" : "Member"}</Pill>
              </div>;
            })}
            {!memberRows?.length && <div><span><b>No members yet.</b></span></div>}
          </div>
          {isOwner && <form action={inviteMemberAction} className="app-form" style={{ borderTop: "1px solid #edf0f4", maxWidth: "none" }}>
            <div className="form-grid">
              <label>Invite by email<input type="email" name="email" required placeholder="member@example.com" /></label>
              <label>Role<select name="role"><option value="member">Member</option><option value="owner">Owner</option></select></label>
            </div>
            <button className="button primary" style={{ justifySelf: "start" }}><Icon name="plus" />Create invite</button>
          </form>}
        </Card>

        {isOwner && !!pendingInvites.length && <Card id="invites">
          <div className="settings-head"><h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>Pending invitations</h2><p>Invitations that have been sent but not yet accepted.</p></div>
          <div className="team-list">
            {pendingInvites.map((i) => <div key={i.email}>
              <i className="avatar" aria-hidden="true"><Icon name="bell" /></i>
              <span><b>{i.email}</b><small>Expires {new Date(i.expires_at).toLocaleDateString("en-GB")}</small></span>
              <Pill tone={i.role === "owner" ? "blue" : "neutral"}>{i.role === "owner" ? "Owner" : "Member"}</Pill>
              <Pill tone="amber">Pending</Pill>
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
