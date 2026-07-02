import { demoSoaExport } from "@/features/soa/application/demo-export";
import { generateSoaPdf } from "@/features/soa/application/export";

export async function GET() {
  const content = await generateSoaPdf(demoSoaExport);
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="compliancehub-statement-of-applicability.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
