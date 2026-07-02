import { describe, expect, it } from "vitest";
import { buildSoaExportView, generateSoaDocx, generateSoaPdf } from "./export";
import type { SoaSnapshot } from "../domain/soa";

const snapshot: SoaSnapshot = {
  assessmentId: "assessment-1", version: 2, finalisedAt: "2026-07-02T08:00:00.000Z", finalisedBy: "Alex Owner",
  items: [{ questionId: "A.1", suggestedStatus: "implemented", status: "implemented", reviewed: true, justification: "Required for operations", evidence: "Policy-01" }],
};

describe("SoA exports", () => {
  it("builds one deterministic view model used by every format", () => {
    expect(buildSoaExportView(snapshot, { organisationName: "Acme Ltd", catalogueVersion: "2022-v1" })).toEqual(expect.objectContaining({
      title: "Statement of Applicability", organisationName: "Acme Ltd", version: 2, catalogueVersion: "2022-v1",
      items: [expect.objectContaining({ reference: "A.1", statusLabel: "Implemented" })],
    }));
  });

  it("generates a valid PDF buffer", async () => {
    const buffer = await generateSoaPdf(buildSoaExportView(snapshot, { organisationName: "Acme Ltd", catalogueVersion: "2022-v1" }));
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("generates a valid DOCX archive", async () => {
    const buffer = await generateSoaDocx(buildSoaExportView(snapshot, { organisationName: "Acme Ltd", catalogueVersion: "2022-v1" }));
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });
});
