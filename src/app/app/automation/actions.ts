"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveEvidenceProvider } from "@/features/integrations/application/evidence-registry";
import type { EvidenceProviderKind } from "@/features/integrations/domain/evidence-provider";
import { automationConnectionId, persistCollectedAutomation } from "@/features/automation/application/collector-persistence";
import { purgeContentReference } from "@/features/automation/domain/retention";

export async function reviewAutomationProposalAction(formData: FormData) {
  const { supabase, user } = await requireAppContext();
  await enforceRateLimit(`automation-review:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  if (decision !== "accepted" && decision !== "dismissed") throw new Error("Invalid automation review decision");
  const dismissalReason = String(formData.get("dismissalReason") ?? "").trim();
  if (decision === "dismissed" && !dismissalReason) throw new Error("Explain why this automation draft does not apply");
  const { error } = await supabase.rpc("review_automation_proposal", {
    target_proposal_id: id,
    target_decision: decision,
    target_dismissal_reason: decision === "dismissed" ? dismissalReason : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/app/automation");
  revalidatePath("/app/evidence");
  revalidatePath("/app/tasks");
}

export async function revokeAutomationConnectionAction(formData: FormData) {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can disconnect automation systems");
  const id = String(formData.get("id"));
  const { data: connection, error: readError } = await supabase.from("connector_connections")
    .select("id").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (readError || !connection) throw new Error("Automation connection not found");
  const now = new Date().toISOString();
  const { error: revokeError } = await supabase.from("connector_connections")
    .update({ status: "revoked", revoked_at: now }).eq("id", connection.id);
  if (revokeError) throw new Error("Could not disconnect the automation system");
  const { error: sourceRevokeError } = await supabase.from("evidence_sources")
    .update({ revoked_at: now, access_token: null, refresh_token: null })
    .contains("config", { automationConnectionId: connection.id });
  if (sourceRevokeError) throw new Error("Could not revoke the linked evidence source");
  const service = createSupabaseServiceClient();
  const { data: sourceObjects, error: sourceReadError } = await service.from("source_objects")
    .select("id,content_hash").eq("connection_id", connection.id).eq("organisation_id", organisation.id).neq("status", "purged");
  if (sourceReadError) throw new Error("Could not purge connected content");
  for (const source of sourceObjects ?? []) {
    const { error } = await service.from("source_objects").update({ status: "purged", purged_at: now, content_ref: purgeContentReference(source.content_hash) })
      .eq("id", source.id).eq("organisation_id", organisation.id);
    if (error) throw new Error("Could not purge connected content");
  }
  revalidatePath("/app/automation");
}

export async function generateAutomationBaselineAction() {
  const { organisation, membership, user } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can generate an automation baseline");
  await enforceRateLimit(`automation-baseline:${user.id}`, { limit: 3, windowMs: 60_000 });
  const service = createSupabaseServiceClient();
  const { data: sources, error } = await service.from("evidence_sources")
    .select("id,provider,config,access_token").eq("organisation_id", organisation.id).is("revoked_at", null);
  if (error) throw new Error("Could not load configured evidence sources");
  for (const source of sources ?? []) {
    const config = (source.config ?? {}) as Record<string, unknown>;
    if (!automationConnectionId(config)) continue;
    try {
      const provider = resolveEvidenceProvider(source.provider as EvidenceProviderKind);
      const collected = await provider.collect({ id: source.id, provider: source.provider as EvidenceProviderKind, config, accessToken: source.access_token ?? "" });
      for (const item of collected) await persistCollectedAutomation({ supabase: service, organisationId: organisation.id, provider: source.provider as EvidenceProviderKind, config, collected: item });
    } catch {
      // Individual connector failures are reflected by the scheduled collector;
      // a baseline request must still return the drafts from healthy systems.
    }
  }
  revalidatePath("/app/automation");
}
