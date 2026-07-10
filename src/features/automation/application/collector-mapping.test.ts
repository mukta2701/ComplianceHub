import { describe, expect, it } from "vitest";
import { mapCollectedEvidenceToAutomation } from "./collector-mapping";

describe("collected evidence automation mapping", () => {
  it("creates provenance, a deterministic signal, and a draft proposal for a connected source", () => {
    const draft = mapCollectedEvidenceToAutomation({
      organisationId: "org-1",
      connectionId: "connection-1",
      connectionOwnerId: "owner-1",
      assignedOwnerId: "engineer-1",
      retentionDays: 30,
      provider: "github",
      collected: {
        externalRef: "repo:acme/app:branches",
        title: "Branch protection settings",
        kind: "link",
        url: "https://github.example/acme/app/settings/branches",
        collectedOn: "2026-07-10",
        validUntil: "2026-08-09",
      },
    });

    expect(draft.sourceObject).toMatchObject({
      externalRef: "repo:acme/app:branches",
      title: "Branch protection settings",
      classification: "metadata",
      contentRef: "evidence://repo:acme/app:branches",
      expiresAt: "2026-08-09T00:00:00.000Z",
    });
    expect(draft.signal).toMatchObject({ type: "github.branch_protection", confidence: "high" });
    expect(draft.proposal).toMatchObject({
      targetType: "evidence",
      assignedTo: "engineer-1",
      createdBy: "owner-1",
      status: "draft",
    });
    expect(draft.proposal.output).toMatchObject({ state: "needs_review", confidence: "high" });
  });

  it("uses the connector owner when an area has not been assigned", () => {
    const draft = mapCollectedEvidenceToAutomation({
      organisationId: "org-1",
      connectionId: "connection-1",
      connectionOwnerId: "owner-1",
      assignedOwnerId: null,
      retentionDays: 30,
      provider: "aws",
      collected: {
        externalRef: "securityhub:failed:3",
        title: "Security Hub findings",
        kind: "note",
        note: "3 failed Security Hub controls require review.",
        collectedOn: "2026-07-10",
        validUntil: null,
      },
    });

    expect(draft.proposal).toMatchObject({ assignedTo: "owner-1", targetType: "task" });
    expect(draft.sourceObject.expiresAt).toBe("2026-08-09T00:00:00.000Z");
  });
});
