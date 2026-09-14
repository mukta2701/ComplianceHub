import { NextResponse } from "next/server";
import { requireAppContext } from "@/lib/app-context";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { protectExport, recordExportAudit } from "@/features/exports/export-audit";
import { one } from "@/lib/supabase/one";

type Row = { title: string; kind: string; status: string; collected_on: string; valid_until: string | null; profiles: { display_name: string } | { display_name: string }[] | null };

export async function GET(request: Request) {
  const format: "csv" | "xlsx" = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const { supabase, organisation, user } = await requireAppContext();
  const auditContext = { organisationId: organisation.id, userId: user.id, resource: "evidence" as const, format };
  await protectExport(auditContext);
  const result = await supabase.from("evidence").select("id,title,kind,status,collected_on,valid_until,profiles:owner_id(display_name)").eq("organisation_id", organisation.id).order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: "Could not export evidence" }, { status: 500, headers: { "cache-control": "private, no-store" } });
  const rows = (result.data ?? []) as unknown as Row[];
  const columns: ExportColumn<Row>[] = [
    { header: "Title", value: (e) => e.title },
    { header: "Kind", value: (e) => e.kind },
    { header: "Status", value: (e) => e.status },
    { header: "Collected on", value: (e) => e.collected_on },
    { header: "Valid until", value: (e) => e.valid_until ?? "" },
    { header: "Owner", value: (e) => one(e.profiles)?.display_name ?? "Unassigned" },
  ];
  if (format === "csv") {
    await recordExportAudit(auditContext);
    return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="evidence.csv"', "cache-control": "private, no-store" } });
  }
  const buffer = await toXlsx("Evidence", columns, rows);
  await recordExportAudit(auditContext);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="evidence.xlsx"', "cache-control": "private, no-store" } });
}
