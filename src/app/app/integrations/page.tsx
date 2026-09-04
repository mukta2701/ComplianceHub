import { Card, PageIntro } from "@/components/ui";
import { z } from "zod";
import { SubTabs } from "@/components/sub-tabs";
import { hasCapability } from "@/features/organisations/domain/access";
import { requireAppContext } from "@/lib/app-context";
import { canShowDeveloperTools } from "@/lib/security/developer-tools";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createJiraOAuthGateway } from "@/features/integrations/application/jira-oauth";
import { createSupabaseJiraConnectionStore, getFreshJiraAccessToken, type JiraPersistenceDatabase } from "@/features/integrations/application/jira-token-store";
import { getJiraProviderConfig } from "@/features/integrations/application/provider-config";
import { JiraSetupPanel, type JiraSetupProject, type JiraSetupSite } from "./jira-setup-panel";
import {
  GitHubInstallationPanel,
  type GitHubInstallationSummary,
  type GitHubRepositoryConfigurationSummary,
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
  type NativeJiraConnectionSummary,
} from "./connections-catalog";

type Connection = ConnectionSummary & {
  created_at: string;
  revoked_at: string | null;
};

type AlertChannel = AlertChannelSummary & {
  created_at: string;
  revoked_at: string | null;
};

const jiraSiteSchema = z.object({
  cloudId: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
}).strip();

async function loadJiraSetupData(input: {
  step: "site" | "project";
  id: string;
  organisationId: string;
  userId: string;
}): Promise<{ sites?: JiraSetupSite[]; projects?: JiraSetupProject[] }> {
  try {
    const service = createSupabaseServiceClient();
    if (input.step === "site") {
      const { data, error } = await service.rpc("read_pending_jira_sites", {
        target_organisation_id: input.organisationId,
        target_user_id: input.userId,
        target_setup_id: input.id,
      });
      if (error || !Array.isArray(data) || data.length !== 1) return { sites: [] };
      const parsed = z.object({ sites: z.array(jiraSiteSchema).max(100) }).strip().safeParse(data[0]);
      return parsed.success ? { sites: parsed.data.sites } : { sites: [] };
    }

    const { data: connection, error } = await service.from("integration_connections")
      .select("id,provider_account_id")
      .eq("id", input.id)
      .eq("organisation_id", input.organisationId)
      .eq("provider", "jira")
      .eq("connection_mode", "jira_oauth")
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !connection || typeof connection.provider_account_id !== "string") return { projects: [] };
    const gateway = createJiraOAuthGateway(getJiraProviderConfig());
    const store = createSupabaseJiraConnectionStore(service as unknown as JiraPersistenceDatabase);
    const accessToken = await getFreshJiraAccessToken({ connectionId: connection.id, gateway, store });
    const projects = await gateway.listProjects({ accessToken, cloudId: connection.provider_account_id });
    return { projects: projects.map((project) => ({ id: project.id, key: project.key, name: project.name })) };
  } catch {
    return input.step === "site" ? { sites: [] } : { projects: [] };
  }
}

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
  searchParams: Promise<{ github?: string | string[]; jira?: string | string[]; setup?: string | string[]; connection?: string | string[] }>;
}) {
  const { supabase, membership, organisation, user } = await requireAppContext();
  const canManageConnections = hasCapability(membership.role, "manage_connections");
  const params = await searchParams;
  if (!canManageConnections) {
    const [installationResult, repositorySummaryResult] = await Promise.all([
      supabase.from("github_installations")
        .select("id,account_login,status,repository_selection,permissions_ok")
        .eq("organisation_id", organisation.id)
        .order("updated_at", { ascending: false }),
      supabase.from("github_repositories")
        .select("id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available")
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
        repositories={(repositorySummaryResult.data ?? []).map((repository) => ({
          ...repository,
          repository_id: repository.id,
        })) as GitHubRepositoryConfigurationSummary[]}
        canManageInstallation={false}
        canManageRepositoryScope={false}
      />
    </>;
  }

  const { github } = params;
  const jira = typeof params.jira === "string" ? params.jira : undefined;
  const setupId = typeof params.setup === "string" ? params.setup : undefined;
  const connectionId = typeof params.connection === "string" ? params.connection : undefined;
  const [connectionsResult, alertChannelsResult, installationResult, repositorySummaryResult, deliveryResult, nativeJiraResult] = await Promise.all([
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
    supabase.from("github_repositories")
      .select("id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available")
      .eq("organisation_id", organisation.id)
      .order("full_name", { ascending: true }),
    membership.role === "owner"
      ? supabase.from("daily_digest_deliveries")
        .select("id,digest_on,channel_id,status,attempt_count,error_code,last_attempted_at,delivered_at")
        .eq("organisation_id", organisation.id)
        .order("digest_on", { ascending: false })
        .limit(10)
      : Promise.resolve({ data: [] as DailyDigestDeliverySummary[], error: null }),
    supabase.rpc("list_native_jira_connection_summaries", {
      target_organisation_id: organisation.id,
    }),
  ]);

  if (
    connectionsResult.error
    || alertChannelsResult.error
    || installationResult.error
    || repositorySummaryResult.error
    || deliveryResult.error
    || nativeJiraResult.error
  ) {
    throw new Error("Could not load connection settings");
  }

  const connections = ((connectionsResult.data ?? []) as Connection[])
    .filter((connection) => !connection.revoked_at);
  const alertChannels = ((alertChannelsResult.data ?? []) as AlertChannel[])
    .filter((channel) => !channel.revoked_at);
  const nativeJiraRows = (nativeJiraResult.data ?? []) as Array<Omit<NativeJiraConnectionSummary, "target_count"> & { target_count: number | bigint }>;
  const nativeJiraConnections = nativeJiraRows.map((connection) => ({
    ...connection,
    target_count: Number(connection.target_count),
  })) as NativeJiraConnectionSummary[];
  const showDeveloperTools = canShowDeveloperTools({
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.E2E_TEST_TOOLS_ENABLED === "1",
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  const jiraSetup = jira === "select-site" && setupId
    ? await loadJiraSetupData({ step: "site", id: setupId, organisationId: organisation.id, userId: user.id })
    : jira === "select-project" && connectionId
      ? await loadJiraSetupData({ step: "project", id: connectionId, organisationId: organisation.id, userId: user.id })
      : null;

  return <>
    {(jira === "projects-saved" || jira === "setup-required" || jira === "connection-failed") && <Card role="status" style={{ padding: "16px", margin: "0 auto 16px", maxWidth: "1100px" }}>
      {jira === "projects-saved" ? "Jira projects saved and ready to sync." : jira === "setup-required" ? "Jira connection is not configured yet." : "Jira could not be connected. Please try again."}
    </Card>}
    {jiraSetup && jira === "select-site" && setupId && <JiraSetupPanel step="site" setupId={setupId} sites={jiraSetup.sites} />}
    {jiraSetup && jira === "select-project" && connectionId && <JiraSetupPanel step="project" connectionId={connectionId} projects={jiraSetup.projects} />}
    {github === "connected" && <Card
      role="status"
      aria-label="GitHub connection status"
      style={{ padding: "16px", background: "#eef7f0", borderColor: "#cfe6d5", margin: "0 auto 16px", maxWidth: "1100px" }}
    >
      <b>GitHub repository access connected.</b> Choose the repositories to include in monitoring below.
    </Card>}
    <ConnectionsCatalog
      connections={connections}
      alertChannels={alertChannels}
      nativeJiraConnections={nativeJiraConnections}
      canManageDailyDigest={membership.role === "owner"}
      digestDeliveries={(deliveryResult.data ?? []) as DailyDigestDeliverySummary[]}
      navigation={<SubTabs tabs={[
        { href: "/app/settings", label: "Settings" },
        { href: "/app/integrations", label: "Connections" },
      ]} />}
    />
    <GitHubInstallationPanel
      installations={(installationResult.data ?? []) as GitHubInstallationSummary[]}
      repositories={(repositorySummaryResult.data ?? []).map((repository) => ({
        ...repository,
        repository_id: repository.id,
      })) as GitHubRepositoryConfigurationSummary[]}
      canManageInstallation={membership.role === "owner"}
      canManageRepositoryScope={membership.role === "owner"}
    />
    {showDeveloperTools && <DeveloperConnectionTools />}
  </>;
}
