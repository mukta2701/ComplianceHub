import PDFDocument from "pdfkit";
import { RISK_BAND_LABEL, type RiskBand } from "@/features/risks/domain/risks";
import type { ReadinessReport } from "@/features/reports/domain/readiness-report";

// Renders the leadership readiness snapshot as a one-page PDF, mirroring the
// SoA snapshot export's stream-to-buffer pattern (see features/soa/application/export.ts).
export function generateReadinessPdf(report: ReadinessReport, organisationName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Readiness report — ${organisationName}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(20).text("Leadership readiness report").moveDown(0.3);
    doc.fontSize(10).text(`Organisation: ${organisationName}`).text(`Generated: ${new Date().toISOString().slice(0, 10)}`).moveDown();
    doc.fontSize(12).text(`Framework coverage: ${report.soaPercent}% (${report.soaTotal} applicable controls)`);
    doc.text(`Tasks: ${report.tasksOpen} open, ${report.tasksOverdue} overdue`);
    doc.text(`Evidence: ${report.evidence.total} live, ${report.evidence.expiring} expiring, ${report.evidence.expired} expired`);
    doc.text(`Audits: ${report.openAudits} open, ${report.openNonConformities} open non-conformities`).moveDown();
    doc.fontSize(13).text("Risk posture").fontSize(11);
    for (const band of Object.keys(report.riskBands) as RiskBand[]) doc.text(`${RISK_BAND_LABEL[band]}: ${report.riskBands[band]}`);
    doc.end();
  });
}
