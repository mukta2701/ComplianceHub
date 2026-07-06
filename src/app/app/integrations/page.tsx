import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { addConnectionAction, revokeConnectionAction } from "./actions";

export default async function IntegrationsPage() {
  const { supabase, membership } = await requireAppContext();
  // Tokens are NEVER selected here — only non-secret columns.
  const { data: connections } = await supabase.from("integration_connections")
    .select("id,provider,label,config,created_at,revoked_at").order("created_at", { ascending: false });
  const isOwner = membership.role === "owner";
  return <>
    <PageIntro eyebrow="INTEGRATIONS" title="Ticketing integrations" body="Connect Jira or GitHub Issues, then push remediation tasks as tickets and sync their status back." />
    {!isOwner && <Card style={{ padding: "18px" }} role="note"><p>Only workspace owners can manage integrations.</p></Card>}
    {isOwner && <>
      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <h2 style={{ fontSize: "15px", margin: 0 }}>Connect Jira or GitHub</h2>
          <Pill tone="amber">Sandbox mode</Pill>
        </div>
        <p style={{ fontSize: "13px", color: "#4a5163", margin: "0 0 8px" }}>Add a connection below to push remediation tasks to your tracker as tickets, then sync their status back into ComplianceHub.</p>
        <p style={{ fontSize: "13px", color: "#596273", margin: 0 }}>You&rsquo;re in <b>sandbox mode</b>: new connections use a built-in tracker, so you can trial the push&rarr;sync flow safely without touching a real Jira or GitHub project. When you&rsquo;re ready to connect the real thing, your workspace administrator can follow the going-live steps below.</p>
        <details style={{ marginTop: "14px", borderTop: "1px solid #edf0f4", paddingTop: "12px" }}>
          <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "var(--blue)", width: "fit-content" }}>For your administrator: going live</summary>
          <p style={{ fontSize: "12px", color: "#596273", margin: "10px 0 6px" }}>Connecting a real tracker needs a one-off setup by whoever manages your hosting. It involves registering an OAuth app with Jira or GitHub, adding the credentials to your deployment, enabling the background sync, and securing the stored access tokens. Share this page with your administrator when you&rsquo;re ready.</p>
        </details>
      </Card>
      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add a connection</h2>
        <form action={addConnectionAction} className="app-form">
          <div className="form-grid">
            <label>Provider<select name="provider" defaultValue="jira"><option value="jira">Jira</option><option value="github">GitHub Issues</option></select></label>
            <label>Label<input name="label" maxLength={160} placeholder="Engineering Jira" /></label>
            <label>Jira base URL<input name="baseUrl" maxLength={300} placeholder="https://acme.atlassian.net" /></label>
            <label>Jira project key<input name="projectKey" maxLength={80} placeholder="ENG" /></label>
            <label>GitHub owner<input name="owner" maxLength={120} placeholder="acme" /></label>
            <label>GitHub repo<input name="repo" maxLength={120} placeholder="isms" /></label>
          </div>
          <label>Access token (optional in sandbox)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
          <button className="button primary">Add connection</button>
        </form>
      </Card>
      <Card style={{ padding: "18px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Connections</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
          {(connections ?? []).map((c) => <li key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
            <span><b>{c.label || c.provider}</b> · {c.provider} {c.revoked_at ? <Pill tone="neutral">Revoked</Pill> : <Pill tone="green">Active</Pill>}</span>
            {!c.revoked_at && <form action={revokeConnectionAction}><input type="hidden" name="id" value={c.id} /><button style={{ color: "var(--red)", border: 0, background: "none", fontWeight: 700 }}>Revoke</button></form>}
          </li>)}
          {!connections?.length && <li style={{ color: "#596273" }}>No connections yet. Add one above to start pushing tasks as tickets.</li>}
        </ul>
      </Card>
    </>}
  </>;
}
