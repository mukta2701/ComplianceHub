import { Card, PageIntro } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { hasCapability } from "@/features/organisations/domain/access";
import { requireAppContext } from "@/lib/app-context";
import {
  addConnectionAction,
  addEvidenceSourceAction,
  addMonitorSourceAction,
} from "./actions";
import {
  ConnectionsCatalog,
  type AlertChannelSummary,
  type ConnectionSummary,
} from "./connections-catalog";

type Connection = ConnectionSummary & {
  created_at: string;
  revoked_at: string | null;
};

type AlertChannel = AlertChannelSummary & {
  created_at: string;
  revoked_at: string | null;
};

function DeveloperConnectionTools() {
  return <details className="card developer-connection-tools">
    <summary>Local preview tools</summary>
    <p>
      Add deterministic sample connections for local development. These tools are never shown in production.
    </p>

    <h3>Sandbox task tracker</h3>
    <form action={addConnectionAction} className="app-form">
      <div className="form-grid">
        <label>Provider<select name="provider" defaultValue="jira"><option value="jira">Jira</option><option value="github">GitHub Issues</option></select></label>
        <label>Label<input name="label" maxLength={160} placeholder="Engineering Jira" /></label>
        <label>Jira Cloud URL<input name="baseUrl" maxLength={300} placeholder="https://acme.atlassian.net" /></label>
        <label>Jira project key<input name="projectKey" maxLength={80} placeholder="ENG" /></label>
        <label>GitHub owner<input name="owner" maxLength={39} placeholder="acme" /></label>
        <label>GitHub repo<input name="repo" maxLength={100} placeholder="isms" /></label>
      </div>
      <label>Developer token (optional)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
      <button className="button secondary" type="submit">Add sandbox tracker</button>
    </form>

    <h3>Sandbox monitoring source</h3>
    <form action={addMonitorSourceAction} className="app-form">
      <div className="form-grid">
        <label>GitHub owner<input name="owner" maxLength={39} placeholder="acme" required /></label>
        <label>Repository<input name="repo" maxLength={100} placeholder="isms" required /></label>
        <label>Label<input name="label" maxLength={160} placeholder="Production repository" /></label>
      </div>
      <label>Developer token (optional)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
      <button className="button secondary" type="submit">Add sandbox monitoring source</button>
    </form>

    <h3>Evidence source</h3>
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
      <label>Developer credential (optional)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
      <button className="button secondary" type="submit">Add evidence source</button>
    </form>
  </details>;
}

export default async function IntegrationsPage() {
  const { supabase, membership, organisation } = await requireAppContext();
  const canManageConnections = hasCapability(membership.role, "manage_connections");

  if (!canManageConnections) {
    return <>
      <PageIntro
        eyebrow="SETTINGS · CONNECTIONS"
        title="Connections"
        body="Connected workplace systems are managed by workspace operators."
      />
      <Card style={{ padding: "18px" }} role="note">
        <p style={{ margin: 0 }}>Connections are managed by workspace Owners and Admins.</p>
      </Card>
    </>;
  }

  const [connectionsResult, alertChannelsResult] = await Promise.all([
    supabase.from("integration_connections")
      .select("id,provider,label,config,connection_mode,enabled,created_at,revoked_at")
      .eq("organisation_id", organisation.id)
      .order("created_at", { ascending: false }),
    // The encrypted destination is deliberately excluded from this projection.
    supabase.from("alert_channels")
      .select("id,type,label,min_severity,enabled,created_at,revoked_at")
      .eq("organisation_id", organisation.id)
      .order("created_at", { ascending: false }),
  ]);

  if (connectionsResult.error || alertChannelsResult.error) {
    throw new Error("Could not load connection settings");
  }

  const connections = ((connectionsResult.data ?? []) as Connection[])
    .filter((connection) => !connection.revoked_at);
  const alertChannels = ((alertChannelsResult.data ?? []) as AlertChannel[])
    .filter((channel) => !channel.revoked_at);

  return <>
    <ConnectionsCatalog
      connections={connections}
      alertChannels={alertChannels}
      navigation={<SubTabs tabs={[
        { href: "/app/settings", label: "Settings" },
        { href: "/app/integrations", label: "Connections" },
      ]} />}
    />
    {process.env.NODE_ENV === "development" && <DeveloperConnectionTools />}
  </>;
}
