"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveEvidenceProvider } from "@/features/integrations/application/evidence-registry";
import type { EvidenceProviderKind } from "@/features/integrations/domain/evidence-provider";
import { automationConnectionId, persistCollectedAutomation } from "@/features/automation/application/collector-persistence";
import { purgeContentReference } from "@/features/automation/domain/retention";
import { configuredAiProvider } from "@/features/ai/application/openai-compatible";
import { generateAiSuggestion } from "@/features/ai/application/suggestion";
import { buildAutomationProposalAiContext } from "@/features/ai/domain/context";
import { decryptSecret } from "@/lib/security/secrets";

export async function reviewAutomationProposalAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`automation-review:${user.id}`, { limit: 30, windowMs: 60_000 });
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  if (decision !== "accepted" && decision !== "dismissed") throw new Error("Invalid automation review decision");
  const dismissalReason = String(formData.get("dismissalReason") ?? "").trim();
  if (decision === "dismissed" && !dismissalReason) throw new Error("Explain why this automation draft does not apply");
  const { data: proposal, error: proposalError } = await supabase.from("automation_proposals")
    .select("id").eq("id", id).eq("organisation_id", organisation.id).eq("assigned_to", user.id).eq("status", "draft").maybeSingle();
  if (proposalError || !proposal) throw new Error("Automation draft not found");
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

export async function createAutomationTaskDraftAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`automation-task-draft:${user.id}`, { limit: 20, windowMs: 60_000 });
  const proposalId = String(formData.get("id") ?? "");
  const { data: proposal, error: proposalError } = await supabase.from("automation_proposals")
    .select("id,target_type,assigned_to,status,output,automation_signals(summary)")
    .eq("id", proposalId).eq("organisation_id", organisation.id).eq("assigned_to", user.id).eq("status", "draft").maybeSingle();
  if (proposalError || !proposal) throw new Error("Automation draft not found or already reviewed");
  const output = proposal.output && typeof proposal.output === "object" ? proposal.output as { title?: unknown; why?: unknown; recommendedAction?: unknown } : {};
  const title = typeof output.title === "string" && output.title.trim() ? output.title.trim() : "Automation remediation review";
  const marker = `[automation-proposal:${proposal.id}]`;
  const { data: existing, error: existingError } = await supabase.from("tasks").select("id").eq("organisation_id", organisation.id).eq("created_by", user.id).eq("detail", marker).maybeSingle();
  if (existingError) throw new Error("Could not check for an existing task draft");
  if (!existing) {
    const { error } = await supabase.from("tasks").insert({
      organisation_id: organisation.id,
      title: `Draft remediation: ${title}`.slice(0, 200),
      detail: marker,
      status: "open",
      owner_id: user.id,
      source: "system",
      created_by: user.id,
    });
    if (error && error.code !== "23505") throw new Error("Could not create the task draft");
  }
  revalidatePath("/app/automation");
  revalidatePath("/app/tasks");
}

export async function recollectAutomationProposalAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`automation-recollect:${user.id}`, { limit: 3, windowMs: 60_000 });
  const proposalId = String(formData.get("id") ?? "");
  const { data: proposal, error: proposalError } = await supabase.from("automation_proposals")
    .select("id,assigned_to,status,automation_signals(connection_id)")
    .eq("id", proposalId).eq("organisation_id", organisation.id).eq("assigned_to", user.id).eq("status", "draft").maybeSingle();
  const signal = Array.isArray(proposal?.automation_signals) ? proposal?.automation_signals[0] : proposal?.automation_signals;
  if (proposalError || !proposal || !signal?.connection_id) throw new Error("Automation draft source not found");
  const service = createSupabaseServiceClient();
  const { data: connection, error: connectionError } = await service.from("connector_connections")
    .select("id,provider,status").eq("id", signal.connection_id).eq("organisation_id", organisation.id).maybeSingle();
  if (connectionError || !connection || connection.status === "revoked") throw new Error("Automation connection is not available");
  const { data: source, error: sourceError } = await service.from("evidence_sources")
    .select("provider,config,access_token").eq("organisation_id", organisation.id).eq("provider", connection.provider).contains("config", { automationConnectionId: connection.id }).is("revoked_at", null).maybeSingle();
  if (sourceError || !source) throw new Error("No recollection source is configured for this connection");
  const config = (source.config ?? {}) as Record<string, unknown>;
  const provider = resolveEvidenceProvider(source.provider as EvidenceProviderKind);
  const collected = await provider.collect({ id: connection.id, provider: source.provider as EvidenceProviderKind, config, accessToken: decryptSecret(source.access_token) ?? "" });
  for (const item of collected) await persistCollectedAutomation({ supabase: service, organisationId: organisation.id, provider: source.provider as EvidenceProviderKind, config, collected: item });
  revalidatePath("/app/automation");
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
    .eq("organisation_id", organisation.id)
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
      const collected = await provider.collect({ id: source.id, provider: source.provider as EvidenceProviderKind, config, accessToken: decryptSecret(source.access_token) ?? "" });
      for (const item of collected) await persistCollectedAutomation({ supabase: service, organisationId: organisation.id, provider: source.provider as EvidenceProviderKind, config, collected: item });
    } catch {
      // Individual connector failures are reflected by the scheduled collector;
      // a baseline request must still return the drafts from healthy systems.
    }
  }
  revalidatePath("/app/automation");
}

export async function generateAutomationExplanationAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`automation-ai:${user.id}`, { limit: 20, windowMs: 60 * 60_000 });
  const proposalId = String(formData.get("id"));
  const { data: settings } = await supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle();
  if (!settings?.enabled) throw new Error("AI assistance is disabled for this workspace");
  let provider: ReturnType<typeof configuredAiProvider> = null;
  try {
    provider = configuredAiProvider();
  } catch {
    provider = null;
  }
  if (!provider) throw new Error("AI assistance is not configured");
  const { data: proposal, error: proposalError } = await supabase.from("automation_proposals")
    .select("id,target_type,assigned_to,status,output,automation_signals(id,signal_type,summary)").eq("id", proposalId).eq("organisation_id", organisation.id).eq("assigned_to", user.id).eq("status", "draft").maybeSingle();
  const signal = Array.isArray(proposal?.automation_signals) ? proposal?.automation_signals[0] : proposal?.automation_signals;
  if (proposalError || !proposal || !signal || !proposal.output || typeof proposal.output !== "object") throw new Error("Automation draft not found");
  const output = proposal.output as { title?: unknown; confidence?: unknown };
  const { data: sourceLink } = await supabase.from("automation_proposal_sources")
    .select("source_objects(id,title)").eq("proposal_id", proposal.id).eq("organisation_id", organisation.id).limit(1).maybeSingle();
  const source = Array.isArray(sourceLink?.source_objects) ? sourceLink.source_objects[0] : sourceLink?.source_objects;
  const context = buildAutomationProposalAiContext({
    proposal: { id: proposal.id, targetType: proposal.target_type, title: typeof output.title === "string" ? output.title : "Automation draft", confidence: typeof output.confidence === "string" ? output.confidence : "low" },
    signal: { id: signal.id, type: signal.signal_type, summary: signal.summary },
    sourceObject: source ? { id: source.id, title: source.title } : null,
  });
  const suggestion = await generateAiSuggestion({ provider, context });
  const { error } = await supabase.from("ai_suggestions").insert({
    organisation_id: organisation.id,
    target_type: "automation_proposal",
    target_id: proposal.id,
    suggestion_type: "automation_explanation",
    requester_id: user.id,
    input_snapshot: context,
    output: suggestion,
    source_references: suggestion.sourceReferences,
  });
  if (error) throw new Error("Could not save the AI draft");
  revalidatePath("/app/automation");
}
