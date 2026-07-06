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
        <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Go-live checklist</h2>
        <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#4a5163", display: "grid", gap: "4px" }}>
          <li>Register an OAuth app with your provider (Jira or GitHub) and note the client id and secret.</li>
          <li>Set the provider client id/secret and <code>INTEGRATIONS_LIVE=1</code> in the server environment.</li>
          <li>Add the connection below with a valid access token; tokens are stored owner-only and never shown again.</li>
          <li>Enable the poll cron (<code>/api/cron/integrations-sync</code>) with a Vercel cron and <code>CRON_SECRET</code>.</li>
          <li>Production only: move tokens to Supabase Vault or an encrypted column.</li>
        </ol>
        <p style={{ fontSize: "12px", color: "#596273", margin: "8px 0 0" }}>Until <code>INTEGRATIONS_LIVE=1</code> is set, connections use a built-in sandbox tracker so you can trial the flow safely.</p>
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
