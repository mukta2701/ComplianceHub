import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { inviteMemberAction } from "../actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { membership, organisation } = await requireAppContext(); const { invite } = await searchParams;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return <>
    <PageIntro eyebrow="SETTINGS" title="Organisation settings" body={`${organisation.name} · your role: ${membership.role}`} />
    {invite && <Card style={{ padding: "16px", background: "#eef7f0", borderColor: "#cfe6d5", marginBottom: "16px" }}><b>Invitation created.</b><p style={{ marginTop: "8px", wordBreak: "break-all", fontSize: "13px" }}>{site}/app/invitations/accept?token={invite}</p></Card>}
    {membership.role === "owner" && <form action={inviteMemberAction} className="card app-form" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "12px", alignItems: "end" }}><label>Email<input type="email" name="email" required placeholder="member@example.com" /></label><label>Role<select name="role"><option value="member">Member</option><option value="owner">Owner</option></select></label><button className="button primary">Create invite</button></form>}
    <p style={{ marginTop: "16px", fontSize: "12px", color: "#596273" }}>ComplianceHub supports readiness management. It does not provide certification or legal advice.</p>
  </>;
}
