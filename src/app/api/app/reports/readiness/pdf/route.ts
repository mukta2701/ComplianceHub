import { NextResponse } from "next/server";
import { requireAppContext } from "@/lib/app-context";
import { loadReadinessInput } from "@/features/reports/application/load-readiness";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { generateReadinessPdf } from "@/features/reports/application/readiness-pdf";
import { loadLatestLeadershipSnapshot } from "@/features/reports/application/leadership-snapshots";

// Auth + tenant scoping via requireAppContext(): the returned Supabase client is
// RLS-scoped to the caller's session (no service role), matching the readiness
// report page (src/app/app/reports/readiness/page.tsx) this route exports from.
export async function GET() {
  const { supabase, organisation, membership } = await requireAppContext();
  let report;
  let organisationName: string;
  if (membership.role === "member") {
    const snapshot = await loadLatestLeadershipSnapshot(supabase, organisation.id);
    if (!snapshot) {
      return NextResponse.json({ error: "Leadership report not found" }, {
        status: 404,
        headers: { "cache-control": "private, no-store" },
      });
    }
    report = snapshot.payload;
    organisationName = snapshot.organisationName;
  } else {
    report = buildReadinessReport(await loadReadinessInput(supabase, organisation.id));
    organisationName = organisation.name;
  }
  const buffer = await generateReadinessPdf(report, organisationName);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="readiness-report.pdf"',
      "cache-control": "private, no-store",
    },
  });
}
