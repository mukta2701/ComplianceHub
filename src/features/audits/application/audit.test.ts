import { describe, expect, it } from "vitest";
import { auditInputSchema, findingInputSchema } from "./audit";

const auditInput = {
  organisationId: "00000000-0000-4000-8000-000000000001",
  reference: "AUD-001",
  title: "Access control audit",
  scope: "Identity and access management",
  leadAuditorId: "",
  framework: "ISO 27001:2022",
};

describe("audit input", () => {
  it("rejects a working window that ends before it starts", () => {
    const result = auditInputSchema.safeParse({
      ...auditInput,
      plannedStart: "2026-09-20",
      plannedEnd: "2026-09-10",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Planned end must be on or after planned start");
  });

  it("accepts an open or chronological working window", () => {
    expect(auditInputSchema.safeParse({ ...auditInput, plannedStart: "", plannedEnd: "" }).success).toBe(true);
    expect(auditInputSchema.safeParse({ ...auditInput, plannedStart: "2026-09-10", plannedEnd: "2026-09-20" }).success).toBe(true);
  });
});

describe("audit finding input", () => {
  it("rejects a corrective task without a corrective action", () => {
    const result = findingInputSchema.safeParse({
      auditId: "00000000-0000-4000-8000-000000000002",
      checklistItemId: "",
      summary: "Dormant account remains active",
      severity: "minor_nc",
      rootCause: "",
      correctiveAction: "",
      ownerId: "",
      dueOn: "",
      spawnTask: "on",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Corrective action is required when raising a task");
  });
});
