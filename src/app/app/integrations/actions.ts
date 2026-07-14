"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { encryptSecret } from "@/lib/security/secrets";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { connectionInputSchema, connectionTargetInputSchema } from "@/features/integrations/application/connection";
import { evidenceSourceInputSchema } from "@/features/integrations/application/evidence-source";
import { hasCapability } from "@/features/organisations/domain/access";
import {
  createNangoConnectSession,
  deleteNangoConnection,
  resolveJiraOAuthTarget,
  verifyNangoConnection,
  verifyGitHubOAuthTarget,
} from "@/features/integrations/application/nango";

const providerSchema = z.enum(["github", "jira"]);
const brokerReferenceSchema = z.object({
  provider: providerSchema,
  connectionId: z.string().trim().min(1).max(255),
  providerConfigKey: z.string().trim().min(1).max(255),
}).strict();
const toggleSchema = z.object({
  id: z.uuid(),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
});
const monitorSourceSchema = z.object({
  owner: z.string().trim().min(1, "GitHub owner is required").max(120),
  repo: z.string().trim().min(1, "Repository is required").max(120),
  label: z.string().trim().max(160).optional(),
  accessToken: z.string().trim().max(4_000).optional(),
});
const alertChannelSchema = z.object({
  endpoint: z.string().trim().url().refine(
    (url) => url.startsWith("https://hooks.slack.com/services/"),
    "Must be a Slack incoming-webhook URL (https://hooks.slack.com/services/…)",
  ),
  minSeverity: z.enum(["low", "medium", "high", "critical"]),
  label: z.string().trim().max(160).optional(),
});

async function requireConnectionManager() {
  const context = await requireAppContext();
  if (!hasCapability(context.membership.role, "manage_connections")) {
    throw new Error("Only workspace operators can manage integrations");
  }
  return context;
}

export async function addConnectionAction(formData: FormData) {
  const { supabase, user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`connection:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = connectionInputSchema.parse(Object.fromEntries(formData));
  const config = parsed.provider === "jira"
    ? { baseUrl: parsed.baseUrl, projectKey: parsed.projectKey }
    : { owner: parsed.owner, repo: parsed.repo };
  const { error } = await supabase.from("integration_connections").insert({
    organisation_id: organisation.id, provider: parsed.provider, label: parsed.label || parsed.provider,
    config, access_token: encryptSecret(parsed.accessToken || null), connected_by: user.id,
    connection_mode: "sandbox", enabled: true,
  });
  if (error) throw new Error("Could not add the connection");
  revalidatePath("/app/integrations");
}

export async function startProviderAuthorizationAction(providerInput: unknown) {
  const { user, organisation } = await requireConnectionManager();
  const provider = providerSchema.parse(providerInput);
  await enforceRateLimit(`provider-connect:${user.id}`, { limit: 10, windowMs: 60_000 });
  const email = user.email ?? "";
  return createNangoConnectSession({
    provider,
    endUser: {
      id: user.id,
      email,
      displayName: email.split("@")[0] || "Workspace operator",
    },
    organisation: { id: organisation.id, displayName: organisation.name },
  });
}

export async function confirmProviderAuthorizationAction(input: unknown) {
  const { user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`provider-confirm:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = brokerReferenceSchema.parse(input);
  await verifyNangoConnection({
    ...parsed,
    endUserId: user.id,
    endUserEmail: user.email ?? "",
    organisationId: organisation.id,
  });

  const service = createSupabaseServiceClient();
  const { error } = await service.from("integration_connections").insert({
    organisation_id: organisation.id,
    provider: parsed.provider,
    label: parsed.provider === "github" ? "GitHub" : "Jira",
    config: {},
    connection_mode: "oauth",
    broker_connection_id: parsed.connectionId,
    broker_provider_config_key: parsed.providerConfigKey,
    // Authorization proves access but does not yet choose a Jira project or
    // GitHub repository. Keep it disabled until that target is configured.
    enabled: false,
    access_token: null,
    refresh_token: null,
    connected_by: user.id,
  });
  if (error) throw new Error("Could not save the verified provider connection");
  revalidatePath("/app/integrations");
}

export async function setIntegrationConnectionEnabledAction(formData: FormData) {
  const { supabase, organisation } = await requireConnectionManager();
  const parsed = toggleSchema.parse(Object.fromEntries(formData));
  const { data: connection, error: lookupError } = await supabase.from("integration_connections")
    .select("id,provider,connection_mode,broker_connection_id,broker_provider_config_key")
    .eq("id", parsed.id)
    .eq("organisation_id", organisation.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (lookupError || !connection) throw new Error("Connection was not found in this workspace");

  let mutationClient = supabase;
  let brokerReference: z.infer<typeof brokerReferenceSchema> | null = null;
  if (connection.connection_mode === "oauth") {
    brokerReference = brokerReferenceSchema.parse({
      provider: connection.provider,
      connectionId: connection.broker_connection_id,
      providerConfigKey: connection.broker_provider_config_key,
    });
    mutationClient = createSupabaseServiceClient();
  } else if (connection.connection_mode !== "sandbox") {
    throw new Error("Connection was not found in this workspace");
  }

  let mutation = mutationClient.from("integration_connections")
    .update({ enabled: parsed.enabled })
    .eq("id", parsed.id)
    .eq("organisation_id", organisation.id)
    .eq("provider", connection.provider)
    .eq("connection_mode", connection.connection_mode)
    .is("revoked_at", null);
  if (brokerReference) {
    mutation = mutation
      .eq("broker_connection_id", brokerReference.connectionId)
      .eq("broker_provider_config_key", brokerReference.providerConfigKey);
  }
  const { data, error } = await mutation.select("id").maybeSingle();
  if (error || !data) throw new Error("Connection was not found in this workspace");
  revalidatePath("/app/integrations");
  revalidatePath("/app/monitoring");
}

export async function configureOAuthConnectionAction(formData: FormData) {
  const { supabase, organisation } = await requireConnectionManager();
  const id = z.uuid().parse(String(formData.get("id")));
  const target = connectionTargetInputSchema.parse(Object.fromEntries(formData));
  const { data: connection, error: lookupError } = await supabase.from("integration_connections")
    .select("id,broker_connection_id,broker_provider_config_key")
    .eq("id", id)
    .eq("organisation_id", organisation.id)
    .eq("connection_mode", "oauth")
    .eq("provider", target.provider)
    .is("revoked_at", null)
    .maybeSingle();
  if (lookupError || !connection?.broker_connection_id || !connection.broker_provider_config_key) {
    throw new Error("OAuth connection was not found in this workspace");
  }

  let config: Record<string, string>;
  if (target.provider === "github") {
    await verifyGitHubOAuthTarget({
      connectionId: connection.broker_connection_id,
      providerConfigKey: connection.broker_provider_config_key,
      owner: target.owner,
      repo: target.repo,
    });
    config = { owner: target.owner, repo: target.repo };
  } else {
    const { cloudId } = await resolveJiraOAuthTarget({
      connectionId: connection.broker_connection_id,
      providerConfigKey: connection.broker_provider_config_key,
      baseUrl: target.baseUrl,
      projectKey: target.projectKey,
    });
    config = { baseUrl: target.baseUrl, projectKey: target.projectKey, cloudId };
  }
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("integration_connections")
    .update({ config, enabled: true })
    .eq("id", id)
    .eq("organisation_id", organisation.id)
    .eq("connection_mode", "oauth")
    .eq("provider", target.provider)
    .eq("broker_connection_id", connection.broker_connection_id)
    .eq("broker_provider_config_key", connection.broker_provider_config_key)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("OAuth connection was not found in this workspace");
  revalidatePath("/app/integrations");
  revalidatePath("/app/monitoring");
}

export async function addMonitorSourceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`monitor-source:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = monitorSourceSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("monitor_sources").insert({
    organisation_id: organisation.id,
    provider: "github",
    label: parsed.label || `${parsed.owner}/${parsed.repo}`,
    config: { owner: parsed.owner, repo: parsed.repo },
    access_token: encryptSecret(parsed.accessToken || null),
    connected_by: user.id,
    enabled: true,
  });
  if (error) throw new Error("Could not add the monitoring source");
  revalidatePath("/app/integrations");
  revalidatePath("/app/monitoring");
}

export async function setMonitorSourceEnabledAction(formData: FormData) {
  const { supabase, organisation } = await requireConnectionManager();
  const parsed = toggleSchema.parse(Object.fromEntries(formData));
  const { data, error } = await supabase.from("monitor_sources")
    .update({ enabled: parsed.enabled })
    .eq("id", parsed.id).eq("organisation_id", organisation.id)
    .is("integration_connection_id", null)
    .select("id").maybeSingle();
  if (error || !data) throw new Error("Monitoring source was not found in this workspace");
  revalidatePath("/app/integrations");
  revalidatePath("/app/monitoring");
}

export async function revokeMonitorSourceAction(formData: FormData) {
  const { supabase, organisation } = await requireConnectionManager();
  const id = z.uuid().parse(String(formData.get("id")));
  const { data, error } = await supabase.from("monitor_sources")
    .update({ revoked_at: new Date().toISOString(), enabled: false })
    .eq("id", id).eq("organisation_id", organisation.id)
    .is("integration_connection_id", null)
    .select("id").maybeSingle();
  if (error || !data) throw new Error("Could not disconnect the monitoring source");
  revalidatePath("/app/integrations");
  revalidatePath("/app/monitoring");
}

export async function addAlertChannelAction(formData: FormData) {
  const { supabase, user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`alert-channel:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = alertChannelSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("alert_channels").insert({
    organisation_id: organisation.id,
    type: "slack",
    label: parsed.label || "Slack",
    config: { webhookUrl: encryptSecret(parsed.endpoint) },
    min_severity: parsed.minSeverity,
    connected_by: user.id,
    enabled: true,
  });
  if (error) throw new Error("Could not add the alert channel");
  revalidatePath("/app/integrations");
}

export async function setAlertChannelEnabledAction(formData: FormData) {
  const { supabase, organisation } = await requireConnectionManager();
  const parsed = toggleSchema.parse(Object.fromEntries(formData));
  const { data, error } = await supabase.from("alert_channels")
    .update({ enabled: parsed.enabled })
    .eq("id", parsed.id).eq("organisation_id", organisation.id)
    .select("id").maybeSingle();
  if (error || !data) throw new Error("Alert channel was not found in this workspace");
  revalidatePath("/app/integrations");
}

export async function revokeAlertChannelAction(formData: FormData) {
  const { supabase, organisation } = await requireConnectionManager();
  const id = z.uuid().parse(String(formData.get("id")));
  const { data, error } = await supabase.from("alert_channels")
    .update({ revoked_at: new Date().toISOString(), enabled: false })
    .eq("id", id).eq("organisation_id", organisation.id)
    .select("id").maybeSingle();
  if (error || !data) throw new Error("Could not remove the alert channel");
  revalidatePath("/app/integrations");
}

export async function revokeConnectionAction(formData: FormData) {
  const { supabase, organisation } = await requireConnectionManager();
  const id = z.uuid().parse(String(formData.get("id")));
  const { data: connection, error: lookupError } = await supabase.from("integration_connections")
    .select("id,provider,connection_mode,broker_connection_id,broker_provider_config_key")
    .eq("id", id).eq("organisation_id", organisation.id).is("revoked_at", null).maybeSingle();
  if (lookupError || !connection) throw new Error("Connection was not found in this workspace");
  let brokerReference: z.infer<typeof brokerReferenceSchema> | null = null;
  if (connection.connection_mode === "oauth") {
    brokerReference = brokerReferenceSchema.parse({
      provider: connection.provider,
      connectionId: connection.broker_connection_id,
      providerConfigKey: connection.broker_provider_config_key,
    });
    await deleteNangoConnection(brokerReference);
  } else if (connection.connection_mode !== "sandbox") {
    throw new Error("Connection was not found in this workspace");
  }
  const mutationClient = brokerReference ? createSupabaseServiceClient() : supabase;
  let revokeQuery = mutationClient.from("integration_connections")
    .update({ revoked_at: new Date().toISOString(), enabled: false })
    .eq("id", id)
    .eq("organisation_id", organisation.id)
    .eq("provider", connection.provider)
    .eq("connection_mode", connection.connection_mode)
    .is("revoked_at", null);
  if (brokerReference) {
    revokeQuery = revokeQuery
      .eq("broker_connection_id", brokerReference.connectionId)
      .eq("broker_provider_config_key", brokerReference.providerConfigKey);
  }
  const { data, error } = await revokeQuery.select("id").maybeSingle();
  if (error || !data) throw new Error("Could not revoke the connection");
  revalidatePath("/app/integrations");
  revalidatePath("/app/monitoring");
}

export async function addEvidenceSourceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireConnectionManager();
  await enforceRateLimit(`evidence-source:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = evidenceSourceInputSchema.parse(Object.fromEntries(formData));
  const config = parsed.provider === "google_workspace"
    ? { domain: parsed.domain }
    : parsed.provider === "github"
      ? { owner: parsed.owner, repo: parsed.repo }
      : { account: parsed.account, region: parsed.region };
  const { error } = await supabase.from("evidence_sources").insert({
    organisation_id: organisation.id, provider: parsed.provider, label: parsed.label || parsed.provider,
    config, access_token: encryptSecret(parsed.accessToken || null), connected_by: user.id,
  });
  if (error) throw new Error("Could not add the evidence source");
  revalidatePath("/app/integrations");
}

export async function revokeEvidenceSourceAction(formData: FormData) {
  const { supabase, organisation } = await requireConnectionManager();
  const id = z.uuid().parse(String(formData.get("id")));
  const { data, error } = await supabase.from("evidence_sources").update({ revoked_at: new Date().toISOString() })
    .eq("id", id).eq("organisation_id", organisation.id).select("id").maybeSingle();
  if (error || !data) throw new Error("Could not revoke the evidence source");
  revalidatePath("/app/integrations");
}
