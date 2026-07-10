import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { addConnectionAction, revokeConnectionAction, addEvidenceSourceAction, revokeEvidenceSourceAction } from "./actions";

const EVIDENCE_PROVIDER_LABELS: Record<string, string> = {
  google_workspace: "Google Workspace",
  github: "GitHub",
  aws: "AWS",
};

export default async function IntegrationsPage() {
  const { supabase, membership } = await requireAppContext();
  // Tokens are NEVER selected here — only non-secret columns.
  const [{ data: connections }, { data: sources }] = await Promise.all([
    supabase.from("integration_connections")
      .select("id,provider,label,config,created_at,revoked_at").order("created_at", { ascending: false }),
    // access_token / refresh_token are deliberately excluded from this select.
    supabase.from("evidence_sources")
      .select("id,provider,label,config,created_at,revoked_at").order("created_at", { ascending: false }),
  ]);
  const isOwner = membership.role === "owner";
  return <>
    <PageIntro eyebrow="SETTINGS · CONNECTIONS" title="Connections" body="Connect a tracker to push remediation tasks as tickets, and a source so proof is collected for you. Both start in a safe sandbox." />

    <SubTabs tabs={[{ href: "/app/settings", label: "Settings" }, { href: "/app/integrations", label: "Connections" }]} />

    {!isOwner && <Card style={{ padding: "18px" }} role="note"><p>Only workspace owners can manage integrations.</p></Card>}
    {isOwner && <>
      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <h2 style={{ fontSize: "15px", margin: 0 }}>Task tracker</h2>
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
      <Card style={{ padding: "18px", marginTop: "28px", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <h2 style={{ fontSize: "15px", margin: 0 }}>Evidence sources</h2>
          <Pill tone="amber">Sandbox mode</Pill>
        </div>
        <p style={{ fontSize: "13px", color: "#4a5163", margin: "0 0 8px" }}>Connect a system so ComplianceHub collects proof automatically — access-control reports, config exports and more land in your evidence vault, and stale items automatically raise a task.</p>
        <p style={{ fontSize: "13px", color: "#596273", margin: 0 }}>You&rsquo;re in <b>sandbox mode</b>: new sources use a built-in collector that returns sample evidence, so you can trial the collect flow safely without touching a real Google Workspace, GitHub or AWS account. When you&rsquo;re ready, your workspace administrator can enable live collection.</p>
        <details style={{ marginTop: "14px", borderTop: "1px solid #edf0f4", paddingTop: "12px" }}>
          <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "var(--blue)", width: "fit-content" }}>For your administrator: going live</summary>
          <p style={{ fontSize: "12px", color: "#596273", margin: "10px 0 6px" }}>Live evidence collection needs a one-off setup by whoever manages your hosting: register an OAuth app or service credentials with the provider, add them to the source, enable the background collector, and secure the stored access tokens. Share this page with your administrator when you&rsquo;re ready.</p>
        </details>
      </Card>
      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add an evidence source</h2>
        <form action={addEvidenceSourceAction} className="app-form">
          <div className="form-grid">
            <label>Provider<select name="provider" defaultValue="google_workspace"><option value="google_workspace">Google Workspace</option><option value="github">GitHub</option><option value="aws">AWS</option></select></label>
            <label>Label<input name="label" maxLength={160} placeholder="Corporate Google Workspace" /></label>
            <label>Google Workspace domain<input name="domain" maxLength={300} placeholder="acme.com" /></label>
            <label>GitHub owner<input name="owner" maxLength={120} placeholder="acme" /></label>
            <label>GitHub repo<input name="repo" maxLength={120} placeholder="isms" /></label>
            <label>AWS account<input name="account" maxLength={120} placeholder="123456789012" /></label>
            <label>AWS region<input name="region" maxLength={60} placeholder="eu-west-2" /></label>
          </div>
          <label>Access token (optional in sandbox)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
          <button className="button primary">Add evidence source</button>
        </form>
      </Card>
      <Card style={{ padding: "18px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Sources</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
          {(sources ?? []).map((s) => <li key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
            <span><b>{s.label || EVIDENCE_PROVIDER_LABELS[s.provider] || s.provider}</b> · {EVIDENCE_PROVIDER_LABELS[s.provider] || s.provider} {s.revoked_at ? <Pill tone="neutral">Revoked</Pill> : <Pill tone="green">Active</Pill>}</span>
            {!s.revoked_at && <form action={revokeEvidenceSourceAction}><input type="hidden" name="id" value={s.id} /><button style={{ color: "var(--red)", border: 0, background: "none", fontWeight: 700 }}>Revoke</button></form>}
          </li>)}
          {!sources?.length && <li style={{ color: "#596273" }}>No evidence sources yet. Add one above to start collecting proof automatically.</li>}
        </ul>
      </Card>
    </>}
  </>;
}
