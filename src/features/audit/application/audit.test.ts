import { describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "./audit";

describe("safe audit helper", () => {
  it("removes sensitive metadata recursively before insert", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    await recordAuditEvent({
      organisationId: "org-1", actorId: "user-1", action: "risk.updated", entityType: "risk", entityId: "risk-1",
      metadata: { status: "open", token: "secret", nested: { evidence: "private", count: 2 } },
    }, { insert });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ metadata: { status: "open", nested: { count: 2 } } }));
  });
});
