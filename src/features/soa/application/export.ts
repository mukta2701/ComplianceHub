import PDFDocument from "pdfkit";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { SOA_STATUS_LABEL, type SoaSnapshot, type SoaStatus } from "../domain/soa";

const labels: Record<SoaStatus, string> = SOA_STATUS_LABEL;

export type SoaExportView = Readonly<{
  title: "Statement of Applicability"; organisationName: string; catalogueVersion: string; version: number;
  assessmentId: string; finalisedAt: string; finalisedBy: string;
  items: readonly { reference: string; status: SoaStatus; statusLabel: string; justification: string; evidence: string }[];
}>;

export function buildSoaExportView(snapshot: SoaSnapshot, context: { organisationName: string; catalogueVersion: string }): SoaExportView {
  return {
    title: "Statement of Applicability", ...context, version: snapshot.version, assessmentId: snapshot.assessmentId,
    finalisedAt: snapshot.finalisedAt, finalisedBy: snapshot.finalisedBy,
    items: snapshot.items.map((item) => ({ reference: item.questionId, status: item.status, statusLabel: labels[item.status], justification: item.justification, evidence: item.evidence })),
  };
}

export function generateSoaPdf(view: SoaExportView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${view.title} — ${view.organisationName}` } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.fontSize(20).text(view.title).moveDown();
    document.fontSize(10).text(`Organisation: ${view.organisationName}`).text(`Catalogue: ${view.catalogueVersion}`).text(`Version: ${view.version}`).text(`Assessment: ${view.assessmentId}`).text(`Finalised: ${view.finalisedAt} by ${view.finalisedBy}`).moveDown();
    document.fontSize(9).text("This snapshot preserves manually entered references. Linked evidence records are maintained separately in the workspace evidence vault and are not embedded in this export.").moveDown();
    for (const item of view.items) {
      if (document.y > 700) document.addPage();
      document.fontSize(12).text(`${item.reference} — ${item.statusLabel}`, { continued: false });
      document.fontSize(9).text(`Justification: ${item.justification || "Not provided"}`).text(`Manual evidence references: ${item.evidence || "No manual references recorded"}`).moveDown(0.5);
    }
    document.end();
  });
}

export async function generateSoaDocx(view: SoaExportView): Promise<Buffer> {
  const rows = [
    new TableRow({ children: ["Reference", "Status", "Justification", "Manual evidence references"].map((text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] })) }),
    ...view.items.map((item) => new TableRow({ children: [item.reference, item.statusLabel, item.justification || "Not provided", item.evidence || "No manual references recorded"].map((text) => new TableCell({ children: [new Paragraph(text)] })) })),
  ];
  const document = new Document({ sections: [{ children: [
    new Paragraph({ text: view.title, heading: HeadingLevel.TITLE }),
    new Paragraph(`Organisation: ${view.organisationName}`), new Paragraph(`Catalogue: ${view.catalogueVersion}`),
    new Paragraph(`Version: ${view.version}`), new Paragraph(`Assessment: ${view.assessmentId}`), new Paragraph(`Finalised: ${view.finalisedAt} by ${view.finalisedBy}`),
    new Paragraph("This snapshot preserves manually entered references. Linked evidence records are maintained separately in the workspace evidence vault and are not embedded in this export."),
    new Table({ rows }),
  ] }] });
  return Packer.toBuffer(document);
}
