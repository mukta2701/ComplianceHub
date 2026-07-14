import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { hasCapability } from "@/features/organisations/domain/access";
import { OAuthConnectButton } from "./oauth-connect-button";
import {
  addAlertChannelAction,
  addConnectionAction,
  addEvidenceSourceAction,
  addMonitorSourceAction,
  configureOAuthConnectionAction,
  revokeAlertChannelAction,
  revokeConnectionAction,
  revokeEvidenceSourceAction,
  revokeMonitorSourceAction,
  setAlertChannelEnabledAction,
  setIntegrationConnectionEnabledAction,
  setMonitorSourceEnabledAction,
} from "./actions";

const EVIDENCE_PROVIDER_LABELS: Record<string, string> = {
  google_workspace: "Google Workspace",
  github: "GitHub",
  aws: "AWS",
};
const PROVIDER_LABELS: Record<string, string> = { github: "GitHub", jira: "Jira" };

type Connection = {
  id: string;
  provider: "github" | "jira";
  label: string;
  config: { owner?: string; repo?: string; baseUrl?: string; projectKey?: string };
  connection_mode: "sandbox" | "oauth";
  enabled: boolean;
  created_at: string;
  revoked_at: string | null;
};
type MonitorSource = {
  id: string;
  provider: "github";
  label: string;
  config: { owner?: string; repo?: string };
  enabled: boolean;
  created_at: string;
  revoked_at: string | null;
};
type AlertChannel = {
  id: string;
  type: string;
  label: string;
  min_severity: string;
  enabled: boolean;
  created_at: string;
  revoked_at: string | null;
};
type EvidenceSource = {
  id: string;
  provider: string;
  label: string;
  config: Record<string, unknown>;
  created_at: string;
  revoked_at: string | null;
};

function ToggleForm({
  id,
  enabled,
  label,
  action,
}: {
  id: string;
  enabled: boolean;
  label: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return <form action={action}>
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="enabled" value={String(!enabled)} />
    <button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>
      {enabled ? `Disable ${label}` : `Enable ${label}`}
    </button>
  </form>;
}

function OAuthTargetForm({ connection }: { connection: Connection }) {
  const providerLabel = PROVIDER_LABELS[connection.provider];
  return <form action={configureOAuthConnectionAction} className="app-form" style={{ marginTop: "12px" }}>
    <input type="hidden" name="id" value={connection.id} />
    <input type="hidden" name="provider" value={connection.provider} />
    <div className="form-grid">
      {connection.provider === "github" ? <>
        <label>GitHub owner<input name="owner" maxLength={120} placeholder="acme" required /></label>
        <label>Repository<input name="repo" maxLength={120} placeholder="isms" required /></label>
      </> : <>
        <label>Jira Cloud URL<input name="baseUrl" type="url" maxLength={300} placeholder="https://acme.atlassian.net" required /></label>
        <label>Project key<input name="projectKey" maxLength={80} placeholder="SEC" required /></label>
      </>}
    </div>
    <button className="button primary">Save target and enable {providerLabel} connection</button>
  </form>;
}

export default async function IntegrationsPage() {
  const { supabase, membership } = await requireAppContext();
  const canManageConnections = hasCapability(membership.role, "manage_connections");
  const [connections, monitorSources, alertChannels, evidenceSources] = canManageConnections
    ? await Promise.all([
        supabase.from("integration_connections")
          .select("id,provider,label,config,connection_mode,enabled,created_at,revoked_at")
          .order("created_at", { ascending: false }).then((result) => (result.data ?? []) as Connection[]),
        // Tokens are deliberately excluded. Only the target label is rendered.
        supabase.from("monitor_sources")
          .select("id,provider,label,config,enabled,created_at,revoked_at")
          .order("created_at", { ascending: false }).then((result) => (result.data ?? []) as MonitorSource[]),
        // config contains the encrypted webhook and must never be selected here.
        supabase.from("alert_channels")
          .select("id,type,label,min_severity,enabled,created_at,revoked_at")
          .order("created_at", { ascending: false }).then((result) => (result.data ?? []) as AlertChannel[]),
        // access_token / refresh_token are deliberately excluded.
        supabase.from("evidence_sources")
          .select("id,provider,label,config,created_at,revoked_at")
          .order("created_at", { ascending: false }).then((result) => (result.data ?? []) as EvidenceSource[]),
      ])
    : [[], [], [], []];

  const liveConnections = connections.filter((connection) => !connection.revoked_at);
  const liveMonitorSources = monitorSources.filter((source) => !source.revoked_at);
  const liveAlertChannels = alertChannels.filter((channel) => !channel.revoked_at);

  return <>
    <PageIntro
      eyebrow="SETTINGS · CONNECTIONS"
      title="Connections"
      body="Owners and Admins connect workplace systems and choose where monitoring alerts are delivered."
    />
    <SubTabs tabs={[{ href: "/app/settings", label: "Settings" }, { href: "/app/integrations", label: "Connections" }]} />

    {!canManageConnections && <Card style={{ padding: "18px" }} role="note">
      <p style={{ margin: 0 }}>Connections are managed by workspace Owners and Admins.</p>
    </Card>}

    {canManageConnections && <>
      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <div className="card-head"><div>
          <h3>Systems</h3>
          <p>Authorize GitHub or Jira with OAuth, then choose the repository or project ComplianceHub may use.</p>
        </div><Link href="/app/monitoring">Open Monitoring</Link></div>
        <p style={{ fontSize: "13px", color: "#596273", margin: "0 0 14px" }}>
          OAuth grants ComplianceHub access to a provider. It is separate from SSO, which signs people into ComplianceHub.
          Provider tokens stay with the OAuth broker and are never sent to this page.
        </p>
        <div className="form-grid" style={{ marginBottom: "16px" }}>
          <div className="soft-panel" style={{ padding: "14px" }}>
            <strong>GitHub</strong>
            <p style={{ fontSize: "12px", color: "#596273" }}>GitHub Issues and authorized provider API access.</p>
            <OAuthConnectButton provider="github" />
          </div>
          <div className="soft-panel" style={{ padding: "14px" }}>
            <strong>Jira</strong>
            <p style={{ fontSize: "12px", color: "#596273" }}>Projects, remediation tickets and status sync.</p>
            <OAuthConnectButton provider="jira" />
          </div>
        </div>
        <div id="deployment-checkpoint" className="notice" style={{ marginBottom: "16px" }}>
          If a Connect button reports that provider setup is required, complete the Nango, GitHub and Jira steps in <code>docs/deployment.md</code>.
          Nothing is connected until those deployment credentials and your provider approval are in place.
        </div>
        {liveConnections.length > 0 ? <ul className="monitor-list">
          {liveConnections.map((connection) => {
            const label = connection.label || PROVIDER_LABELS[connection.provider];
            const pendingTarget = connection.connection_mode === "oauth" && !connection.enabled
              && Object.keys(connection.config ?? {}).length === 0;
            return <li key={connection.id} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <span className="ml-body" style={{ flex: "1 1 260px" }}>
                <strong>{label}</strong>
                <span className="ml-meta">
                  <Pill tone="neutral">{PROVIDER_LABELS[connection.provider]}</Pill>
                  <Pill tone={pendingTarget ? "amber" : connection.enabled ? "green" : "neutral"}>
                    {pendingTarget ? "Authorized · setup required" : connection.enabled ? "Enabled" : "Disabled"}
                  </Pill>
                  <span>{connection.connection_mode === "oauth" ? "OAuth" : "Sandbox"}</span>
                </span>
                {pendingTarget && <OAuthTargetForm connection={connection} />}
              </span>
              <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {!pendingTarget && <ToggleForm id={connection.id} enabled={connection.enabled} label={`${PROVIDER_LABELS[connection.provider]} connection`} action={setIntegrationConnectionEnabledAction} />}
                <form action={revokeConnectionAction}><input type="hidden" name="id" value={connection.id} /><button className="button secondary">Revoke</button></form>
              </span>
            </li>;
          })}
        </ul> : <p className="empty-note">No GitHub or Jira systems are connected yet.</p>}
      </Card>

      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <div className="card-head"><div><h3>Monitoring sources</h3><p>Enabled sources are checked and shown to Members.</p></div></div>
        {liveMonitorSources.length > 0 ? <ul className="monitor-list">
          {liveMonitorSources.map((source) => <li key={source.id} style={{ flexWrap: "wrap" }}>
            <span className="ml-body"><strong>{source.label}</strong><span className="ml-meta">
              <Pill tone="neutral">GitHub</Pill><Pill tone={source.enabled ? "green" : "neutral"}>{source.enabled ? "Enabled" : "Disabled"}</Pill>
              <span>{source.config?.owner}/{source.config?.repo}</span>
            </span></span>
            <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <ToggleForm id={source.id} enabled={source.enabled} label={source.label} action={setMonitorSourceEnabledAction} />
              <form action={revokeMonitorSourceAction}><input type="hidden" name="id" value={source.id} /><button className="button secondary">Disconnect</button></form>
            </span>
          </li>)}
        </ul> : <p className="empty-note">No systems are currently configured for monitoring.</p>}
      </Card>

      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <div className="card-head"><div><h3>Alert channels</h3><p>Choose where new monitoring findings notify your team.</p></div></div>
        <ul className="monitor-list" style={{ marginBottom: "14px" }}>
          <li><span className="ml-body"><strong>In-app notifications</strong><span className="ml-meta"><Pill tone="green">Always on</Pill><span>Workspace operators receive every finding in ComplianceHub.</span></span></span></li>
          {liveAlertChannels.map((channel) => <li key={channel.id} style={{ flexWrap: "wrap" }}>
            <span className="ml-body"><strong>{channel.label}</strong><span className="ml-meta"><Pill tone="neutral">Slack</Pill><Pill tone={channel.enabled ? "green" : "neutral"}>{channel.enabled ? "Enabled" : "Disabled"}</Pill><span>{channel.min_severity} and above</span></span></span>
            <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <ToggleForm id={channel.id} enabled={channel.enabled} label={channel.label} action={setAlertChannelEnabledAction} />
              <form action={revokeAlertChannelAction}><input type="hidden" name="id" value={channel.id} /><button className="button secondary">Remove</button></form>
            </span>
          </li>)}
        </ul>
        <form action={addAlertChannelAction} className="app-form">
          <div className="form-grid">
            <label>Slack destination URL<input name="endpoint" type="url" placeholder="Paste the Slack HTTPS endpoint" required /></label>
            <label>Alert at<select name="minSeverity" defaultValue="high"><option value="low">Low and above</option><option value="medium">Medium and above</option><option value="high">High and above</option><option value="critical">Critical only</option></select></label>
            <label>Label<input name="label" maxLength={160} placeholder="#compliance-alerts" /></label>
          </div>
          <button className="button primary">Add Slack channel</button>
          <p className="field-hint">The destination is encrypted and never displayed again.</p>
        </form>
      </Card>

      <details className="card" style={{ padding: "18px", marginBottom: "16px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Local sandbox / developer setup</summary>
        <p style={{ fontSize: "13px", color: "#596273" }}>
          These manual forms keep local demos and deterministic tests working. Production workspaces should use the OAuth buttons above.
        </p>
        <h3 style={{ fontSize: "15px" }}>Sandbox task tracker</h3>
        <form action={addConnectionAction} className="app-form">
          <div className="form-grid">
            <label>Provider<select name="provider" defaultValue="jira"><option value="jira">Jira</option><option value="github">GitHub Issues</option></select></label>
            <label>Label<input name="label" maxLength={160} placeholder="Engineering Jira" /></label>
            <label>Jira Cloud URL<input name="baseUrl" maxLength={300} placeholder="https://acme.atlassian.net" /></label>
            <label>Jira project key<input name="projectKey" maxLength={80} placeholder="ENG" /></label>
            <label>GitHub owner<input name="owner" maxLength={120} placeholder="acme" /></label>
            <label>GitHub repo<input name="repo" maxLength={120} placeholder="isms" /></label>
          </div>
          <label>Developer token (optional)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
          <button className="button secondary">Add sandbox tracker</button>
        </form>
        <h3 style={{ fontSize: "15px", marginTop: "20px" }}>Sandbox monitoring source</h3>
        <form action={addMonitorSourceAction} className="app-form">
          <div className="form-grid">
            <label>GitHub owner<input name="owner" maxLength={120} placeholder="acme" required /></label>
            <label>Repository<input name="repo" maxLength={120} placeholder="isms" required /></label>
            <label>Label<input name="label" maxLength={160} placeholder="Production repository" /></label>
          </div>
          <label>Developer token (optional)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
          <button className="button secondary">Add sandbox monitoring source</button>
        </form>
      </details>

      <Card style={{ padding: "18px" }}>
        <div className="card-head"><div><h3>Evidence sources</h3><p>Keep the existing automated evidence collection workflow.</p></div></div>
        <form action={addEvidenceSourceAction} className="app-form" style={{ marginBottom: "14px" }}>
          <div className="form-grid">
            <label>Provider<select name="provider" defaultValue="google_workspace"><option value="google_workspace">Google Workspace</option><option value="github">GitHub</option><option value="aws">AWS</option></select></label>
            <label>Label<input name="label" maxLength={160} placeholder="Corporate Google Workspace" /></label>
            <label>Google Workspace domain<input name="domain" maxLength={300} placeholder="acme.com" /></label>
            <label>GitHub owner<input name="owner" maxLength={120} placeholder="acme" /></label>
            <label>GitHub repo<input name="repo" maxLength={120} placeholder="isms" /></label>
            <label>AWS account<input name="account" maxLength={120} placeholder="123456789012" /></label>
            <label>AWS region<input name="region" maxLength={60} placeholder="eu-west-2" /></label>
          </div>
          <label>Developer credential (optional)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
          <button className="button secondary">Add evidence source</button>
        </form>
        <ul className="monitor-list">
          {evidenceSources.filter((source) => !source.revoked_at).map((source) => <li key={source.id}>
            <span className="ml-body"><strong>{source.label || EVIDENCE_PROVIDER_LABELS[source.provider] || source.provider}</strong><span className="ml-meta"><Pill tone="neutral">{EVIDENCE_PROVIDER_LABELS[source.provider] || source.provider}</Pill></span></span>
            <form action={revokeEvidenceSourceAction}><input type="hidden" name="id" value={source.id} /><button className="button secondary">Revoke</button></form>
          </li>)}
        </ul>
      </Card>
    </>}
  </>;
}
