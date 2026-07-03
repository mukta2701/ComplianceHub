import { describe, expect, it } from "vitest";
import { gapTaskInputSchema, taskInputSchema } from "./task";

const ORGANISATION_ID = "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111";
const OWNER_ID = "6c71dce7-a0a0-4c2f-8b40-2bf2dab2b222";

describe("taskInputSchema", () => {
  it("accepts a minimal manual task", () => {
    const parsed = taskInputSchema.parse({
      organisationId: ORGANISATION_ID, title: "Review firewall rules",
    });
    expect(parsed.status).toBe("open");
    expect(parsed.detail).toBe("");
  });
  it("rejects an unknown recurrence and a blank title", () => {
    expect(() => taskInputSchema.parse({ organisationId: ORGANISATION_ID, title: " ", recurrence: "daily" })).toThrow();
  });
  it("normalises empty optional fields", () => {
    const parsed = taskInputSchema.parse({
      organisationId: ORGANISATION_ID, title: "T", dueOn: "", ownerId: "", controlId: "", riskId: "", recurrence: "",
    });
    expect(parsed.dueOn).toBeNull();
    expect(parsed.ownerId).toBeNull();
    expect(parsed.recurrence).toBeNull();
  });
});

describe("gapTaskInputSchema", () => {
  it("rejects a gap task with no owner or due date", () => {
    expect(() => gapTaskInputSchema.parse({ organisationId: ORGANISATION_ID, title: "Close gap: X" })).toThrow();
  });
  it("rejects a gap task missing only the due date", () => {
    expect(() => gapTaskInputSchema.parse({ organisationId: ORGANISATION_ID, title: "Close gap: X", ownerId: OWNER_ID })).toThrow();
  });
  it("rejects a gap task missing only the owner", () => {
    expect(() => gapTaskInputSchema.parse({ organisationId: ORGANISATION_ID, title: "Close gap: X", dueOn: "2026-08-01" })).toThrow();
  });
  it("accepts a gap task with both an owner and a due date", () => {
    const parsed = gapTaskInputSchema.parse({ organisationId: ORGANISATION_ID, title: "Close gap: X", ownerId: OWNER_ID, dueOn: "2026-08-01" });
    expect(parsed.ownerId).toBe(OWNER_ID);
    expect(parsed.dueOn).toBe("2026-08-01");
  });
});
