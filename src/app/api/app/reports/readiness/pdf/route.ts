import { NextResponse } from "next/server";
import { requireAppContext } from "@/lib/app-context";
import { loadReadinessInput } from "@/features/reports/application/load-readiness";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { generateReadinessPdf } from "@/features/reports/application/readiness-pdf";

// Auth + tenant scoping via requireAppContext(): the returned Supabase client is
// RLS-scoped to the caller's session (no service role), matching the readiness
// report page (src/app/app/reports/readiness/page.tsx) this route exports from.
export async function GET() {
  const { supabase, organisation } = await requireAppContext();
  const report = buildReadinessReport(await loadReadinessInput(supabase));
  const buffer = await generateReadinessPdf(report, organisation.name);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="readiness-report.pdf"',
      "cache-control": "private, no-store",
    },
  });
}
