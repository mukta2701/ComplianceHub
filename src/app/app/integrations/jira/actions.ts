"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createJiraOAuthGateway } from "@/features/integrations/application/jira-oauth";
import {
  createSupabaseJiraConnectionStore,
  getFreshJiraAccessToken,
  type JiraPersistenceDatabase,
} from "@/features/integrations/application/jira-token-store";
import {
  configureJiraWebhookProjects,
  createSupabaseJiraWebhookLifecycleStore,
  ensureJiraWebhook,
  type JiraWebhookConfiguration,
  type JiraWebhookLifecycleDatabase,
} from "@/features/integrations/application/jira-webhook-lifecycle";
import { getJiraProviderConfig } from "@/features/integrations/application/provider-config";
import { processNativeIntegrationSyncJobAndDrain } from "@/features/integrations/application/native-sync-worker";
import type { IntegrationSyncRpcDatabase } from "@/features/integrations/application/sync-jobs";
import { hasCapability } from "@/features/organisations/domain/access";

const nativeToggleSchema = z.object({
  id: z.uuid(),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
}).strict();
const cloudIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const jiraSiteSelectionSchema = z.object({ setupId: z.uuid(), cloudId: cloudIdSchema }).strict();
const jiraProjectSelectionSchema = z.object({
  connectionId: z.uuid(),
  projectIds: z.array(z.string().regex(/^[1-9][0-9]{0,39}$/)).min(1).max(100),
}).strict();
const jiraWebhookConfigurationRowSchema = z.object({
  id: z.uuid(),
  provider_account_id: cloudIdSchema,
  jira_webhook_generation: z.number().int().min(0).max(2_147_483_646),
  jira_webhook_id: z.string().regex(/^[1-9][0-9]{0,15}$/).nullable(),
  jira_webhook_expires_at: z.string().datetime({ offset: true }).nullable(),
  jira_webhook_callback_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
}).strip();

async function requireConnectionManager() {
  const context = await requireAppContext();
  if (!hasCapability(context.membership.role, "manage_connections")) {
    throw new Error("Only workspace operators can manage integrations");
  }
  return context;
}

function refreshConnectionPages() {
  revalidatePath("/app/settings");
  revalidatePath("/app/integrations");
  revalidatePath("/app/monitoring");
}

function callbackBaseUrl(): string {
  try { return new URL(getJiraProviderConfig().callbackUrl).origin; }
  catch { throw new Error("Jira connection is unavailable"); }
}

async function readJiraWebhookConfiguration(
  service: ReturnType<typeof createSupabaseServiceClient>,
  organisationId: string,
  connectionId: string,
): Promise<JiraWebhookConfiguration> {
  const { data, error } = await service.from("integration_connections")
    .select("id,provider_account_id,jira_webhook_generation,jira_webhook_id,jira_webhook_expires_at,jira_webhook_callback_hash")
    .eq("id", connectionId)
    .eq("organisation_id", organisationId)
    .eq("provider", "jira")
    .eq("connection_mode", "jira_oauth")
    .is("revoked_at", null)
    .maybeSingle();
  const parsed = jiraWebhookConfigurationRowSchema.safeParse(data);
  if (error || !parsed.success) throw new Error("Jira connection was not found in this workspace");
  return {
    organisationId,
    connectionId: parsed.data.id,
    cloudId: parsed.data.provider_account_id,
    generation: parsed.data.jira_webhook_generation,
    webhookId: parsed.data.jira_webhook_id,
    webhookExpiresAt: parsed.data.jira_webhook_expires_at,
    callbackHash: parsed.data.jira_webhook_callback_hash,
  };
}

export async function selectJiraSiteAction(formData: FormData) {
  const { user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`jira-site:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = jiraSiteSelectionSchema.parse(Object.fromEntries(formData));
  const service = createSupabaseServiceClient();
  const store = createSupabaseJiraConnectionStore(service as unknown as JiraPersistenceDatabase);
  const connectionId = await store.finalizePendingAuthorization({
    organisationId: organisation.id,
    userId: user.id,
    setupId: parsed.setupId,
    cloudId: parsed.cloudId,
  });
  redirect(`/app/integrations?jira=select-project&connection=${encodeURIComponent(connectionId)}`);
}

export async function configureJiraProjectsAction(formData: FormData) {
  const { user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`jira-projects:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = jiraProjectSelectionSchema.parse({
    connectionId: formData.get("connectionId"),
    projectIds: formData.getAll("projectId"),
  });
  if (new Set(parsed.projectIds).size !== parsed.projectIds.length) {
    throw new Error("The selected Jira projects are invalid");
  }

  const service = createSupabaseServiceClient();
  const configuration = await readJiraWebhookConfiguration(service, organisation.id, parsed.connectionId);

  const gateway = createJiraOAuthGateway(getJiraProviderConfig());
  const store = createSupabaseJiraConnectionStore(service as unknown as JiraPersistenceDatabase);
  const accessToken = await getFreshJiraAccessToken({ connectionId: parsed.connectionId, gateway, store });
  const [sites, projects] = await Promise.all([
    gateway.listAccessibleResources(accessToken),
    gateway.listProjects({ accessToken, cloudId: configuration.cloudId }),
  ]);
  const site = sites.find((candidate) => candidate.cloudId === configuration.cloudId);
  if (!site) throw new Error("The Jira site is no longer available");
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const selected = parsed.projectIds.map((id) => projectsById.get(id));
  if (selected.some((project) => !project)) {
    throw new Error("The selected Jira projects are no longer available");
  }
  const verifiedProjects = selected.map((project) => ({
    externalId: project!.id,
    displayName: `${project!.key} · ${project!.name}`,
    baseUrl: site.url,
    cloudId: site.cloudId,
    projectKey: project!.key,
  }));
  const webhookStore = createSupabaseJiraWebhookLifecycleStore(
    service as unknown as JiraWebhookLifecycleDatabase,
  );
  await configureJiraWebhookProjects({
    gateway,
    store: webhookStore,
    accessToken,
    configuration,
    organisationId: organisation.id,
    userId: user.id,
    callbackBaseUrl: callbackBaseUrl(),
    verifiedProjects,
  });
  refreshConnectionPages();
  redirect("/app/integrations?jira=projects-saved");
}

export async function setJiraConnectionEnabledAction(formData: FormData) {
  const { user, organisation } = await requireConnectionManager();
  const parsed = nativeToggleSchema.parse(Object.fromEntries(formData));
  const service = createSupabaseServiceClient();
  await readJiraWebhookConfiguration(service, organisation.id, parsed.id);
  if (parsed.enabled) {
    const { data: connection, error: lookupError } = await service.from("integration_connections")
      .select("id,provider,connection_mode")
      .eq("id", parsed.id)
      .eq("organisation_id", organisation.id)
      .is("revoked_at", null)
      .maybeSingle();
    const identity = z.object({
      id: z.uuid(), provider: z.enum(["github", "jira"]), connection_mode: z.string(),
    }).strip().safeParse(connection);
    if (lookupError || !identity.success) throw new Error("Connection could not be updated");
    if (identity.data.provider === "jira" && identity.data.connection_mode === "jira_oauth") {
      const gateway = createJiraOAuthGateway(getJiraProviderConfig());
      const tokenStore = createSupabaseJiraConnectionStore(service as unknown as JiraPersistenceDatabase);
      const webhookStore = createSupabaseJiraWebhookLifecycleStore(
        service as unknown as JiraWebhookLifecycleDatabase,
      );
      const configuration = await readJiraWebhookConfiguration(service, organisation.id, parsed.id);
      const [accessToken, projectKeys] = await Promise.all([
        getFreshJiraAccessToken({ connectionId: parsed.id, gateway, store: tokenStore }),
        webhookStore.readProjectKeys(parsed.id, configuration.generation),
      ]);
      await ensureJiraWebhook({
        gateway,
        store: webhookStore,
        accessToken,
        configuration,
        projectKeys,
        callbackBaseUrl: callbackBaseUrl(),
      });
    }
  }
  const { data, error } = await service.rpc("set_native_connection_enabled", {
    target_organisation_id: organisation.id,
    target_user_id: user.id,
    target_connection_id: parsed.id,
    target_enabled: parsed.enabled,
  });
  if (error || data !== true) throw new Error("Connection could not be updated");
  refreshConnectionPages();
}

export async function syncJiraConnectionAction(formData: FormData) {
  const { user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`connection-sync:${user.id}`, { limit: 5, windowMs: 60_000 });
  const id = z.uuid().parse(formData.get("id"));
  const service = createSupabaseServiceClient();
  await readJiraWebhookConfiguration(service, organisation.id, id);
  const { data, error } = await service.rpc("enqueue_manual_connection_sync", {
    target_organisation_id: organisation.id,
    target_user_id: user.id,
    target_connection_id: id,
    manual_batch_id: randomUUID(),
  });
  const jobId = z.uuid().safeParse(data);
  if (error || !jobId.success) throw new Error("Connection sync could not be queued");
  let outcome: "completed" | "retrying" | "terminal" = "retrying";
  try {
    const result = await processNativeIntegrationSyncJobAndDrain(
      service as unknown as IntegrationSyncRpcDatabase,
      jobId.data,
    );
    outcome = result.state === "completed"
      ? "completed"
      : result.state === "terminal" ? "terminal" : "retrying";
  } catch {
    // The database job remains durable; provider/storage details stay server-side.
  }
  if (outcome === "terminal") {
    throw new Error("Connection sync could not complete. Review the connection settings");
  }
  if (outcome !== "completed") throw new Error("Connection sync was queued and will retry");
  refreshConnectionPages();
}

export async function disconnectJiraConnectionAction(formData: FormData) {
  const { user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`connection-disconnect:${user.id}`, { limit: 10, windowMs: 60_000 });
  const connectionId = z.uuid().parse(formData.get("id"));
  const service = createSupabaseServiceClient();
  const store = createSupabaseJiraConnectionStore(service as unknown as JiraPersistenceDatabase);
  await store.disconnect({
    organisationId: organisation.id,
    userId: user.id,
    connectionId,
  });
  refreshConnectionPages();
}
