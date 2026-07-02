import { demoSoaExport } from "@/features/soa/application/demo-export";
import { generateSoaDocx } from "@/features/soa/application/export";

export async function GET() {
  const content = await generateSoaDocx(demoSoaExport);
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="compliancehub-statement-of-applicability.docx"',
      "Cache-Control": "no-store",
    },
  });
}
