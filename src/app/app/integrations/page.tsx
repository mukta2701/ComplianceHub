import { Card } from "@/components/ui";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SubTabs } from "@/components/sub-tabs";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";
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
import { presentGitHubConnectionHealth } from "@/features/github/components/github-connection-health";
import {
  hasExactReadPermissions,
  READ_PERMISSIONS,
} from "@/features/github/application/github-app-auth";
import type {
  GitHubConnectionDiagnostic,
  GitHubConnectionHealth,
} from "@/features/github/domain/connection-health";
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

const approvedPermissionLabels: Record<keyof typeof READ_PERMISSIONS, string> = {
  metadata: "Metadata — read",
  administration: "Administration — read",
  actions: "Actions — read",
  vulnerability_alerts: "Vulnerability alerts — read",
  security_events: "Security events — read",
  secret_scanning_alerts: "Secret scanning alerts — read",
};

function approvedPermissionLabelsFor(permissions: unknown): string[] {
  if (!hasExactReadPermissions(permissions)) return [];
  return Object.keys(READ_PERMISSIONS).map((permission) => approvedPermissionLabels[permission as keyof typeof READ_PERMISSIONS]);
}

const connectionHealthValues = new Set<GitHubConnectionHealth>([
  "healthy", "retrying", "partially_unavailable", "owner_action_required", "disconnected",
]);
const connectionDiagnosticValues = new Set<GitHubConnectionDiagnostic>([
  "provider_rate_limited", "provider_temporary_failure", "installation_suspended", "installation_revoked",
  "permission_mismatch", "account_mismatch", "repository_unavailable", "invalid_provider_response", "internal_failure",
]);

function exactRowsByInstallationId<T extends { id: string }>(
  rows: readonly T[],
  installationIds: ReadonlySet<string>,
): Map<string, T> {
  if (rows.length !== installationIds.size) throw new Error("Could not load connection settings");
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!installationIds.has(row.id) || byId.has(row.id)) throw new Error("Could not load connection settings");
    byId.set(row.id, row);
  }
  if (byId.size !== installationIds.size) throw new Error("Could not load connection settings");
  return byId;
}

function isConnectionHealth(value: unknown): value is GitHubConnectionHealth {
  return typeof value === "string" && connectionHealthValues.has(value as GitHubConnectionHealth);
}

function isConnectionDiagnostic(value: unknown): value is GitHubConnectionDiagnostic {
  return typeof value === "string" && connectionDiagnosticValues.has(value as GitHubConnectionDiagnostic);
}

function installationSettingsUrl(input: {
  account_login: string;
  account_type: string;
  provider_installation_id: number;
}): string | null {
  if (input.account_type !== "Organization" || !Number.isSafeInteger(input.provider_installation_id) || input.provider_installation_id <= 0) {
    return null;
  }
  return `https://github.com/organizations/${encodeURIComponent(input.account_login)}/settings/installations/${input.provider_installation_id}`;
}

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
  const connectionsAccess = workspaceAccess(membership.role).section("connections");
  if (!connectionsAccess.canView) redirect("/app");
  const params = await searchParams;
  const service = createSupabaseServiceClient();

  const { github } = params;
  const jira = typeof params.jira === "string" ? params.jira : undefined;
  const setupId = typeof params.setup === "string" ? params.setup : undefined;
  const connectionId = typeof params.connection === "string" ? params.connection : undefined;
  const [connectionsResult, alertChannelsResult, installationResult, repositorySummaryResult, healthResult, incidentResult, permissionResult, deliveryResult, nativeJiraResult] = await Promise.all([
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
      .select("id,account_login,account_type,provider_installation_id,status,repository_selection,permissions_ok")
      .eq("organisation_id", organisation.id)
      .order("updated_at", { ascending: false }),
    supabase.from("github_repositories")
      .select("id,installation_id,full_name,html_url,visibility,default_branch,archived,selected,available")
      .eq("organisation_id", organisation.id)
      .order("full_name", { ascending: true }),
    supabase.from("github_connection_health_summaries")
      .select("id,health,health_diagnostic_code,last_successful_reconciliation_at")
      .eq("organisation_id", organisation.id),
    supabase.from("github_connection_incidents")
      .select("id,installation_id,diagnostic_code,health,opened_at,last_observed_at")
      .eq("organisation_id", organisation.id)
      .is("resolved_at", null),
    service.from("github_installations")
      .select("id,permissions")
      .eq("organisation_id", organisation.id),
    connectionsAccess.canManageOperation("select-daily-digest-channel")
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
    || healthResult.error
    || incidentResult.error
    || permissionResult.error
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
  const installationRows = installationResult.data ?? [];
  const installationIds = new Set(installationRows.map((installation) => installation.id));
  if (installationIds.size !== installationRows.length) throw new Error("Could not load connection settings");
  const healthByInstallationId = exactRowsByInstallationId(
    healthResult.data ?? [],
    installationIds,
  );
  const permissionsByInstallationId = exactRowsByInstallationId(
    permissionResult.data ?? [],
    installationIds,
  );
  const incidentByInstallationId = new Map((incidentResult.data ?? []).map((incident) => [incident.installation_id, incident]));
  const now = new Date().toISOString();
  const installations = installationRows.map((installation) => {
    const health = healthByInstallationId.get(installation.id);
    const incident = incidentByInstallationId.get(installation.id);
    const permission = permissionsByInstallationId.get(installation.id);
    if (!health || !permission || !isConnectionHealth(health.health)) throw new Error("Could not load connection settings");
    const healthDiagnostic = health.health_diagnostic_code === null
      ? null
      : isConnectionDiagnostic(health.health_diagnostic_code)
        ? health.health_diagnostic_code
        : (() => { throw new Error("Could not load connection settings"); })();
    const incidentHealth = incident && isConnectionHealth(incident.health) ? incident.health : null;
    const incidentDiagnostic = incident?.diagnostic_code === null || incident?.diagnostic_code === undefined
      ? null
      : isConnectionDiagnostic(incident.diagnostic_code)
        ? incident.diagnostic_code
        : (() => { throw new Error("Could not load connection settings"); })();
    if (incident && !incidentHealth) throw new Error("Could not load connection settings");
    const permissionMismatch = !installation.permissions_ok || !hasExactReadPermissions(permission.permissions);
    const effectiveHealth = incidentHealth ?? (permissionMismatch ? "owner_action_required" : health.health);
    const effectiveDiagnostic = incidentHealth
      ? incidentDiagnostic
      : permissionMismatch
        ? "permission_mismatch"
        : healthDiagnostic;
    const incidentPresentation = incident && incidentHealth
      ? presentGitHubConnectionHealth({
          health: incidentHealth,
          diagnostic: incidentDiagnostic,
          lastSuccessfulReconciliationAt: health.last_successful_reconciliation_at,
          now,
        })
      : null;
    return {
      id: installation.id,
      account_login: installation.account_login,
      status: installation.status,
      repository_selection: installation.repository_selection,
      permissions_ok: installation.permissions_ok,
      health: effectiveHealth,
      health_diagnostic_code: effectiveDiagnostic,
      last_successful_reconciliation_at: health.last_successful_reconciliation_at,
      permission_labels: permissionMismatch ? [] : approvedPermissionLabelsFor(permission.permissions),
      installation_settings_url: installationSettingsUrl({
        account_login: installation.account_login,
        account_type: installation.account_type,
        provider_installation_id: installation.provider_installation_id,
      }),
      incident: incident && incidentPresentation ? {
        summary: incidentPresentation.summary,
        lastObservedAt: incident.last_observed_at,
      } : null,
    };
  }) as GitHubInstallationSummary[];
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
      canManageDailyDigest={connectionsAccess.canManageOperation("select-daily-digest-channel")}
      digestDeliveries={(deliveryResult.data ?? []) as DailyDigestDeliverySummary[]}
      navigation={<SubTabs tabs={[
        { href: "/app/settings", label: "Settings" },
        { href: connectionsAccess.href, label: connectionsAccess.label },
      ]} />}
    />
    <GitHubInstallationPanel
      installations={installations}
      repositories={(repositorySummaryResult.data ?? []).map((repository) => ({
        ...repository,
        repository_id: repository.id,
      })) as GitHubRepositoryConfigurationSummary[]}
      canManageInstallation={connectionsAccess.canManageOperation("manage-github-app")}
      canManageRepositoryScope={connectionsAccess.canManageOperation("manage-github-app")}
      now={now}
    />
    {showDeveloperTools && <DeveloperConnectionTools />}
  </>;
}
