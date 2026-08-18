import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { CollectedEvidence, EvidenceProviderKind } from "@/features/integrations/domain/evidence-provider";
import { mapCollectedEvidenceToAutomation } from "./collector-mapping";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export function automationConnectionId(config: Record<string, unknown>): string | null {
  const id = config.automationConnectionId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export async function persistCollectedAutomation({
  supabase,
  organisationId,
  provider,
  config,
  collected,
}: {
  supabase: ServiceClient;
  organisationId: string;
  provider: EvidenceProviderKind;
  config: Record<string, unknown>;
  collected: CollectedEvidence;
}) {
  const connectionId = automationConnectionId(config);
  if (!connectionId) return false;
  const { data: connection, error: connectionError } = await supabase.from("connector_connections")
    .select("id,owner_id,retention_days,status").eq("id", connectionId).eq("organisation_id", organisationId).maybeSingle();
  if (connectionError || !connection || connection.status === "revoked") return false;

  const { data: existingSourceObject, error: sourceError } = await supabase.from("source_objects")
    .select("id").eq("connection_id", connection.id).eq("external_ref", collected.externalRef).maybeSingle();
  if (sourceError) throw sourceError;
  let sourceObject = existingSourceObject;
  if (!sourceObject) {
    const initial = mapCollectedEvidenceToAutomation({ organisationId, connectionId: connection.id, connectionOwnerId: connection.owner_id, assignedOwnerId: null, retentionDays: connection.retention_days, provider, collected });
    const { data, error } = await supabase.from("source_objects").insert({
      organisation_id: organisationId,
      connection_id: connection.id,
      external_ref: initial.sourceObject.externalRef,
      title: initial.sourceObject.title,
      source_url: initial.sourceObject.sourceUrl,
      content_ref: initial.sourceObject.contentRef,
      content_hash: initial.sourceObject.contentHash,
      classification: initial.sourceObject.classification,
      status: "pending",
      expires_at: initial.sourceObject.expiresAt,
    }).select("id").single();
    if (error || !data) throw error ?? new Error("Could not persist automation provenance");
    sourceObject = data;
  }

  const { data: existingSignal, error: existingSignalError } = await supabase.from("automation_signals")
    .select("id").eq("organisation_id", organisationId).eq("source_object_id", sourceObject.id).maybeSingle();
  if (existingSignalError) throw existingSignalError;

  const initial = mapCollectedEvidenceToAutomation({ organisationId, connectionId: connection.id, connectionOwnerId: connection.owner_id, assignedOwnerId: null, retentionDays: connection.retention_days, provider, collected });
  const { data: assignment, error: assignmentError } = await supabase.from("automation_assignments")
    .select("owner_id").eq("organisation_id", organisationId).eq("area", initial.signal.area).maybeSingle();
  if (assignmentError) throw assignmentError;
  const mapped = mapCollectedEvidenceToAutomation({ organisationId, connectionId: connection.id, connectionOwnerId: connection.owner_id, assignedOwnerId: assignment?.owner_id ?? null, retentionDays: connection.retention_days, provider, collected });
  let changed = !existingSourceObject;
  let signalId = existingSignal?.id;
  if (!signalId) {
    const { data: signal, error: signalError } = await supabase.from("automation_signals").insert({
      organisation_id: organisationId,
      connection_id: connection.id,
      source_object_id: sourceObject.id,
      signal_type: mapped.signal.type,
      summary: mapped.signal.summary,
      facts: mapped.signal.facts,
      confidence: mapped.signal.confidence,
      occurred_at: mapped.signal.occurredAt,
    }).select("id").single();
    if (signalError?.code === "23505") {
      const { data: concurrentSignal, error: concurrentSignalError } = await supabase.from("automation_signals")
        .select("id").eq("organisation_id", organisationId).eq("source_object_id", sourceObject.id).maybeSingle();
      if (concurrentSignalError || !concurrentSignal) throw concurrentSignalError ?? signalError;
      signalId = concurrentSignal.id;
    } else {
      if (signalError || !signal) throw signalError ?? new Error("Could not persist automation signal");
      signalId = signal.id;
      changed = true;
    }
  }

  const { data: existingProposal, error: existingProposalError } = await supabase.from("automation_proposals")
    .select("id").eq("organisation_id", organisationId).eq("signal_id", signalId).limit(1).maybeSingle();
  if (existingProposalError) throw existingProposalError;
  let proposalId = existingProposal?.id;
  if (!proposalId) {
    const { data: proposal, error: proposalError } = await supabase.from("automation_proposals").insert({
      organisation_id: organisationId,
      signal_id: signalId,
      target_type: mapped.proposal.targetType,
      assigned_to: mapped.proposal.assignedTo,
      created_by: mapped.proposal.createdBy,
      input_snapshot: mapped.proposal.inputSnapshot,
      output: mapped.proposal.output,
      source_references: [{ type: "source_object", id: sourceObject.id, label: collected.title }],
    }).select("id").single();
    if (proposalError?.code === "23505") {
      const { data: concurrentProposal, error: concurrentProposalError } = await supabase.from("automation_proposals")
        .select("id").eq("organisation_id", organisationId).eq("signal_id", signalId).limit(1).maybeSingle();
      if (concurrentProposalError || !concurrentProposal) throw concurrentProposalError ?? proposalError;
      proposalId = concurrentProposal.id;
    } else {
      if (proposalError || !proposal) throw proposalError ?? new Error("Could not persist automation proposal");
      proposalId = proposal.id;
      changed = true;
    }
  }

  const { data: existingLink, error: existingLinkError } = await supabase.from("automation_proposal_sources")
    .select("proposal_id").eq("organisation_id", organisationId).eq("proposal_id", proposalId).eq("source_object_id", sourceObject.id).maybeSingle();
  if (existingLinkError) throw existingLinkError;
  if (!existingLink) {
    const { error: linkError } = await supabase.from("automation_proposal_sources").insert({ proposal_id: proposalId, source_object_id: sourceObject.id, organisation_id: organisationId });
    if (linkError?.code !== "23505" && linkError) throw linkError;
    changed = true;
  }
  const { error: healthError } = await supabase.from("connector_connections")
    .update({ last_collected_at: new Date().toISOString(), last_error_at: null, status: "connected" }).eq("id", connection.id).eq("organisation_id", organisationId);
  if (healthError) throw healthError;
  return changed;
}
