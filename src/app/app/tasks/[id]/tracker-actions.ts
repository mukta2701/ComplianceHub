"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { one } from "@/lib/supabase/one";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { decryptSecret } from "@/lib/security/secrets";
import { resolveTicketProvider } from "@/features/integrations/application/registry";
import { buildTicketPayload } from "@/features/integrations/domain/mapping";
import type { IntegrationProvider } from "@/features/integrations/domain/provider";
import { hasCapability } from "@/features/organisations/domain/access";
import { z } from "zod";

export async function pushTaskToTrackerAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_connections")) {
    throw new Error("Only workspace operators can push tracker tickets");
  }
  await enforceRateLimit(`ticket-push:${user.id}`, { limit: 20, windowMs: 60_000 });
  const taskId = z.uuid().parse(String(formData.get("taskId")));
  const connectionId = z.uuid().parse(String(formData.get("connectionId")));
  // Connection is operator-only RLS; a Member sees no rows here and cannot push.
  const { data: connection, error: connError } = await supabase.from("integration_connections")
    .select("id,provider,config,access_token,connection_mode,broker_connection_id,broker_provider_config_key")
    .eq("id", connectionId).eq("organisation_id", organisation.id).eq("enabled", true)
    .is("revoked_at", null).maybeSingle();
  if (connError || !connection) throw new Error("Connection not found or revoked");
  const { data: task, error: taskError } = await supabase.from("tasks")
    .select("id,title,detail,source,controls(code)").eq("id", taskId).eq("organisation_id", organisation.id).maybeSingle();
  if (taskError || !task) throw new Error("Task not found");
  const control = one(task.controls);
  const payload = buildTicketPayload({ title: task.title, detail: task.detail, source: task.source, controlCode: control?.code ?? null });
  const ticketConnection = {
      id: connection.id,
      provider: connection.provider as IntegrationProvider,
      config: connection.config as Record<string, unknown>,
      accessToken: decryptSecret(connection.access_token) ?? "",
      connectionMode: connection.connection_mode as "sandbox" | "oauth",
      brokerConnectionId: connection.broker_connection_id,
      brokerProviderConfigKey: connection.broker_provider_config_key,
    };
  const provider = resolveTicketProvider(ticketConnection);
  const created = await provider.createTicket(ticketConnection, payload);
  const { error } = await supabase.from("task_tickets").insert({
    organisation_id: organisation.id, task_id: taskId, connection_id: connectionId, provider: connection.provider,
    external_id: created.externalId, external_url: created.url, external_status: created.status,
    last_synced_at: new Date().toISOString(), created_by: user.id,
  });
  if (error) throw new Error("Created the ticket but could not record it");
  revalidatePath(`/app/tasks/${taskId}`);
}
