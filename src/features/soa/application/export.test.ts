import { inflateRawSync, inflateSync } from "node:zlib";
import yauzl from "yauzl";
import { describe, expect, it } from "vitest";
import { buildSoaExportView, generateSoaDocx, generateSoaPdf } from "./export";
import type { SoaSnapshot } from "../domain/soa";

const snapshot: SoaSnapshot = {
  assessmentId: "assessment-1", version: 2, finalisedAt: "2026-07-02T08:00:00.000Z", finalisedBy: "Alex Owner",
  items: [{ questionId: "A.1", suggestedStatus: "operational", status: "operational", reviewed: true, justification: "Required for operations", evidence: "Policy-01" }],
};

const emptyEvidenceSnapshot: SoaSnapshot = {
  ...snapshot,
  items: [{ ...snapshot.items[0], evidence: "" }],
};

function extractPdfText(buffer: Buffer): string {
  const source = buffer.toString("latin1");
  const chunks: string[] = [];
  let cursor = 0;
  while (true) {
    const streamStart = source.indexOf("stream", cursor);
    if (streamStart < 0) break;
    const dataStart = source.charCodeAt(streamStart + 6) === 13 && source.charCodeAt(streamStart + 7) === 10
      ? streamStart + 8
      : streamStart + 7;
    const streamEnd = source.indexOf("endstream", dataStart);
    if (streamEnd < 0) break;
    const compressed = buffer.subarray(dataStart, streamEnd);
    try {
      chunks.push(inflateSync(compressed).toString("latin1"));
    } catch {
      try {
        chunks.push(inflateRawSync(compressed).toString("latin1"));
      } catch {
        // Ignore non-content streams such as metadata and continue reading.
      }
    }
    cursor = streamEnd + 9;
  }
  return chunks.join("\n").replace(/<([0-9a-fA-F]+)>/g, (_match, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
}

function normalisePdfText(text: string): string {
  let normalised = text;
  for (let pass = 0; pass < 3; pass += 1) normalised = normalised.replace(/(?<=[A-Za-z])\s+-?\d+(?:\.\d+)?\s+(?=[A-Za-z])/g, "");
  return normalised;
}

function extractDocxText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) {
        reject(error ?? new Error("DOCX archive could not be opened"));
        return;
      }
      archive.readEntry();
      archive.on("entry", (entry) => {
        if (entry.fileName !== "word/document.xml") {
          archive.readEntry();
          return;
        }
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            archive.close();
            reject(streamError ?? new Error("DOCX document stream could not be opened"));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            archive.close();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        });
      });
      archive.on("end", () => reject(new Error("DOCX document.xml entry was not found")));
      archive.on("error", reject);
    });
  });
}

describe("SoA exports", () => {
  it("builds one deterministic view model used by every format", () => {
    expect(buildSoaExportView(snapshot, { organisationName: "Acme Ltd", catalogueVersion: "2022-v1" })).toEqual(expect.objectContaining({
      title: "Statement of Applicability", organisationName: "Acme Ltd", version: 2, catalogueVersion: "2022-v1",
      items: [expect.objectContaining({ reference: "A.1", statusLabel: "Operational" })],
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

  it("keeps the finalised snapshot identity in both exports", async () => {
    const view = buildSoaExportView(snapshot, { organisationName: "Acme Ltd", catalogueVersion: "2022-v1" });
    const [pdf, docx] = await Promise.all([generateSoaPdf(view), generateSoaDocx(view)]);
    const pdfText = extractPdfText(pdf);
    const docxText = await extractDocxText(docx);

    expect(pdfText).toContain("Assessment:");
    expect(pdfText).toContain("assessment-1");
    expect(docxText).toContain("Assessment: assessment-1");
  });

  it("labels manual evidence references and explains linked vault records in both formats", async () => {
    const view = buildSoaExportView(snapshot, { organisationName: "Acme Ltd", catalogueVersion: "2022-v1" });
    const emptyView = buildSoaExportView(emptyEvidenceSnapshot, { organisationName: "Acme Ltd", catalogueVersion: "2022-v1" });
    const [pdf, docx, emptyPdf, emptyDocx] = await Promise.all([
      generateSoaPdf(view), generateSoaDocx(view), generateSoaPdf(emptyView), generateSoaDocx(emptyView),
    ]);
    const [pdfText, docxText, emptyPdfText, emptyDocxText] = await Promise.all([
      normalisePdfText(extractPdfText(pdf)), extractDocxText(docx), normalisePdfText(extractPdfText(emptyPdf)), extractDocxText(emptyDocx),
    ]);

    for (const text of [pdfText, docxText]) {
      expect(text).toContain("Manual evidence references");
      expect(text).toContain("Policy-01");
      expect(text).toContain("Linked evidence records are maintained separately");
    }
    for (const text of [emptyPdfText, emptyDocxText]) {
      expect(text).toContain("No manual references recorded");
      expect(text).toContain("Linked evidence records are maintained separately");
    }
  });
});
