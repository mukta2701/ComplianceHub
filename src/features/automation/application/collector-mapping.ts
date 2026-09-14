import { createHash } from "node:crypto";
import type { CollectedEvidence, EvidenceProviderKind } from "@/features/integrations/domain/evidence-provider";
import { observationKey } from "@/features/integrations/domain/evidence-collection";
import { buildBaselineProposal, normaliseEvidenceSignal } from "../domain/baseline";

type Input = {
  organisationId: string;
  connectionId: string;
  connectionOwnerId: string;
  assignedOwnerId: string | null;
  retentionDays: number;
  provider: EvidenceProviderKind;
  collected: CollectedEvidence;
};

function expiryDate(collected: CollectedEvidence, retentionDays: number): string {
  const date = new Date(`${collected.validUntil ?? collected.collectedOn}T00:00:00.000Z`);
  if (!collected.validUntil) date.setUTCDate(date.getUTCDate() + retentionDays);
  return date.toISOString();
}

export function mapCollectedEvidenceToAutomation(input: Input) {
  const summary = input.collected.note ?? input.collected.title;
  const signal = normaliseEvidenceSignal({
    provider: input.provider,
    externalRef: input.collected.externalRef,
    title: input.collected.title,
    summary,
    sourceUrl: input.collected.url,
    occurredAt: `${input.collected.collectedOn}T00:00:00.000Z`,
  });
  const baseline = buildBaselineProposal(signal);
  const contentRef = `evidence://${input.collected.externalRef}`;
  const contentHash = createHash("sha256")
    .update(`${input.provider}:${input.collected.externalRef}:${summary}`)
    .digest("hex");

  return {
    sourceObject: {
      organisationId: input.organisationId,
      connectionId: input.connectionId,
      externalRef: input.collected.externalRef,
      observationKey: observationKey(input.provider, input.collected),
      collectedOn: input.collected.collectedOn,
      title: input.collected.title,
      sourceUrl: input.collected.url ?? null,
      contentRef,
      contentHash,
      classification: input.collected.kind === "link" ? "metadata" as const : "document" as const,
      expiresAt: expiryDate(input.collected, input.retentionDays),
    },
    signal: {
      organisationId: input.organisationId,
      connectionId: input.connectionId,
      type: signal.type,
      summary: signal.summary,
      facts: { provider: signal.provider, externalRef: signal.externalRef, title: signal.title, sourceUrl: signal.sourceUrl ?? null },
      confidence: signal.confidence,
      occurredAt: signal.occurredAt,
      area: signal.area,
    },
    proposal: {
      organisationId: input.organisationId,
      targetType: baseline.targetType,
      assignedTo: input.assignedOwnerId ?? input.connectionOwnerId,
      createdBy: input.connectionOwnerId,
      status: "draft" as const,
      inputSnapshot: { signalType: signal.type, facts: { provider: signal.provider, externalRef: signal.externalRef, title: signal.title } },
      output: { ...baseline, confidence: signal.confidence },
      sourceReferences: [{ type: "source_object", externalRef: input.collected.externalRef, label: input.collected.title }],
    },
  };
}
