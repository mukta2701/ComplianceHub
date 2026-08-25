import Link from "next/link";
import { Card, PageIntro } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { hasCapability } from "@/features/organisations/domain/access";
import { requireAppContext } from "@/lib/app-context";
import { canShowDeveloperTools } from "@/lib/security/developer-tools";
import {
  GitHubInstallationPanel,
  type GitHubInstallationSummary,
  type GitHubRepositoryShadowSummary,
} from "@/features/github/components/github-installation-panel";
import {
  addConnectionAction,
  addEvidenceSourceAction,
  addMonitorSourceAction,
} from "./actions";
import {
  ConnectionsCatalog,
  type AlertChannelSummary,
  type ConnectionSummary,
  type DailyDigestDeliverySummary,
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

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string | string[] }>;
}) {
  const { supabase, membership, organisation } = await requireAppContext();
  const canManageConnections = hasCapability(membership.role, "manage_connections");
  const params = await searchParams;
  if (!canManageConnections) {
    const [installationResult, repositorySummaryResult] = await Promise.all([
      supabase.from("github_installations")
        .select("id,account_login,status,repository_selection,permissions_ok")
        .eq("organisation_id", organisation.id)
        .order("updated_at", { ascending: false }),
      supabase.from("github_repository_shadow_summaries")
        .select("repository_id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available,latest_run_id,latest_status,latest_failed_count,last_completed_collection_at")
        .eq("organisation_id", organisation.id)
        .order("full_name", { ascending: true }),
    ]);
    if (installationResult.error || repositorySummaryResult.error) {
      throw new Error("Could not load GitHub connection status");
    }
    return <>
      <PageIntro
        eyebrow="SETTINGS · CONNECTIONS"
        title="Connections"
        body="Connected workplace systems are managed by workspace operators."
      />
      <Card style={{ padding: "18px" }} role="note">
        <p style={{ margin: 0 }}>Connections are managed by workspace Owners and Admins.</p>
      </Card>
      <GitHubInstallationPanel
        installations={(installationResult.data ?? []) as GitHubInstallationSummary[]}
        repositories={(repositorySummaryResult.data ?? []) as GitHubRepositoryShadowSummary[]}
        nowIso={new Date().toISOString()}
        canManageInstallation={false}
        canManageRepositoryScope={false}
      />
      <Card style={{ padding: "16px", marginTop: "16px" }}>
        <p style={{ margin: 0 }}><Link href="/app/monitoring">Review GitHub compliance in Monitoring</Link></p>
      </Card>
    </>;
  }

  const { github } = params;
  const [connectionsResult, alertChannelsResult, installationResult, repositorySummaryResult, deliveryResult] = await Promise.all([
    supabase.from("integration_connections")
      .select("id,provider,label,config,connection_mode,enabled,created_at,revoked_at")
      .eq("organisation_id", organisation.id)
      .order("created_at", { ascending: false }),
    // The encrypted destination is deliberately excluded from this projection.
    supabase.from("alert_channels")
      .select("id,type,label,min_severity,enabled,daily_digest_enabled,created_at,revoked_at")
      .eq("organisation_id", organisation.id)
      .order("created_at", { ascending: false }),
    supabase.from("github_installations")
      .select("id,account_login,status,repository_selection,permissions_ok")
      .eq("organisation_id", organisation.id)
      .order("updated_at", { ascending: false }),
    supabase.from("github_repository_shadow_summaries")
      .select("repository_id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available,latest_run_id,latest_status,latest_failed_count,last_completed_collection_at")
      .eq("organisation_id", organisation.id)
      .order("full_name", { ascending: true }),
    membership.role === "owner"
      ? supabase.from("daily_digest_deliveries")
        .select("id,digest_on,channel_id,status,attempt_count,error_code,last_attempted_at,delivered_at")
        .eq("organisation_id", organisation.id)
        .order("digest_on", { ascending: false })
        .limit(10)
      : Promise.resolve({ data: [] as DailyDigestDeliverySummary[], error: null }),
  ]);

  if (
    connectionsResult.error
    || alertChannelsResult.error
    || installationResult.error
    || repositorySummaryResult.error
    || deliveryResult.error
  ) {
    throw new Error("Could not load connection settings");
  }

  const connections = ((connectionsResult.data ?? []) as Connection[])
    .filter((connection) => !connection.revoked_at);
  const alertChannels = ((alertChannelsResult.data ?? []) as AlertChannel[])
    .filter((channel) => !channel.revoked_at);
  const showDeveloperTools = canShowDeveloperTools({
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.E2E_TEST_TOOLS_ENABLED === "1",
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });

  return <>
    {github === "connected" && <Card
      role="status"
      aria-label="GitHub connection status"
      style={{ padding: "16px", background: "#eef7f0", borderColor: "#cfe6d5", margin: "0 auto 16px", maxWidth: "1100px" }}
    >
      <b>GitHub App connected.</b> Choose the repositories to include in shadow collection below.
    </Card>}
    <ConnectionsCatalog
      connections={connections}
      alertChannels={alertChannels}
      canManageDailyDigest={membership.role === "owner"}
      digestDeliveries={(deliveryResult.data ?? []) as DailyDigestDeliverySummary[]}
      navigation={<SubTabs tabs={[
        { href: "/app/settings", label: "Settings" },
        { href: "/app/integrations", label: "Connections" },
      ]} />}
    />
    <GitHubInstallationPanel
      installations={(installationResult.data ?? []) as GitHubInstallationSummary[]}
      repositories={(repositorySummaryResult.data ?? []) as GitHubRepositoryShadowSummary[]}
      nowIso={new Date().toISOString()}
      canManageInstallation={membership.role === "owner"}
      canManageRepositoryScope={membership.role === "owner"}
    />
    <Card style={{ padding: "16px", marginTop: "16px" }}>
      <p style={{ margin: 0 }}><Link href="/app/monitoring">Review GitHub compliance in Monitoring</Link></p>
    </Card>
    {showDeveloperTools && <DeveloperConnectionTools />}
  </>;
}
