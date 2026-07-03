import { describe, expect, it } from "vitest";
import { ALLOWED_EVIDENCE_MIME_TYPES, MAX_EVIDENCE_FILE_BYTES, evidenceInputSchema, persistEvidenceWithCompensation } from "./evidence";

describe("evidenceInputSchema", () => {
  it("accepts link evidence with a URL and rejects link evidence without one", () => {
    const parsed = evidenceInputSchema.parse({
      organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: "SSO configuration", kind: "link", url: "https://example.test/sso",
    });
    expect(parsed.url).toBe("https://example.test/sso");
    expect(() => evidenceInputSchema.parse({ organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: "T", kind: "link", url: "" })).toThrow();
  });
  it("accepts note evidence and normalises empty optionals", () => {
    const parsed = evidenceInputSchema.parse({
      organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: "Access review note", kind: "note", validUntil: "", ownerId: "", reviewInterval: "",
    });
    expect(parsed.validUntil).toBeNull();
    expect(parsed.reviewInterval).toBeNull();
  });
  it("publishes the upload constraints used by the storage bucket", () => {
    expect(MAX_EVIDENCE_FILE_BYTES).toBe(26214400);
    expect(ALLOWED_EVIDENCE_MIME_TYPES).toContain("application/pdf");
  });
  it("removes an uploaded object when the atomic evidence RPC fails", async () => {
    const removed: string[] = [];
    await expect(persistEvidenceWithCompensation({ storagePath: "org/id/file.pdf" }, {
      createRecord: async () => { throw new Error("db failed"); },
      removeUpload: async (path) => { removed.push(path); },
    })).rejects.toThrow("db failed");
    expect(removed).toEqual(["org/id/file.pdf"]);
  });
});
