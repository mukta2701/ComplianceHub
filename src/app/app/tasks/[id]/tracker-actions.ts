"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolveTicketProvider } from "@/features/integrations/application/registry";
import { buildTicketPayload } from "@/features/integrations/domain/mapping";
import type { IntegrationProvider } from "@/features/integrations/domain/provider";

export async function pushTaskToTrackerAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`ticket-push:${user.id}`, { limit: 20, windowMs: 60_000 });
  const taskId = String(formData.get("taskId"));
  const connectionId = String(formData.get("connectionId"));
  // Connection is owner-only RLS; a non-owner sees no rows here and cannot push.
  const { data: connection, error: connError } = await supabase.from("integration_connections")
    .select("id,provider,config,access_token").eq("id", connectionId).is("revoked_at", null).maybeSingle();
  if (connError || !connection) throw new Error("Connection not found or revoked");
  const { data: task, error: taskError } = await supabase.from("tasks")
    .select("id,title,detail,source,controls(code)").eq("id", taskId).maybeSingle();
  if (taskError || !task) throw new Error("Task not found");
  const control = Array.isArray(task.controls) ? task.controls[0] : task.controls;
  const payload = buildTicketPayload({ title: task.title, detail: task.detail, source: task.source, controlCode: control?.code ?? null });
  const provider = resolveTicketProvider(connection.provider as IntegrationProvider);
  const created = await provider.createTicket(
    { id: connection.id, provider: connection.provider as IntegrationProvider, config: connection.config as Record<string, unknown>, accessToken: connection.access_token ?? "" },
    payload,
  );
  const { error } = await supabase.from("task_tickets").insert({
    organisation_id: organisation.id, task_id: taskId, connection_id: connectionId, provider: connection.provider,
    external_id: created.externalId, external_url: created.url, external_status: created.status,
    last_synced_at: new Date().toISOString(), created_by: user.id,
  });
  if (error) throw new Error("Created the ticket but could not record it");
  revalidatePath(`/app/tasks/${taskId}`);
}
