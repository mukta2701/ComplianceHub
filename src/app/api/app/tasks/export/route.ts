import { NextResponse } from "next/server";
import { requireAppContext } from "@/lib/app-context";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { protectExport, recordExportAudit } from "@/features/exports/export-audit";
import { one } from "@/lib/supabase/one";

type Row = { title: string; detail: string; status: string; due_on: string | null; recurrence: string | null; source: string; profiles: { display_name: string } | { display_name: string }[] | null };

export async function GET(request: Request) {
  const format: "csv" | "xlsx" = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const { supabase, organisation, user } = await requireAppContext();
  const auditContext = { organisationId: organisation.id, userId: user.id, resource: "tasks" as const, format };
  await protectExport(auditContext);
  const { data } = await supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,profiles:owner_id(display_name)").eq("organisation_id", organisation.id).order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];
  const columns: ExportColumn<Row>[] = [
    { header: "Title", value: (t) => t.title },
    { header: "Owner", value: (t) => one(t.profiles)?.display_name ?? "Unassigned" },
    { header: "Due date", value: (t) => t.due_on ?? "" },
    { header: "Recurrence", value: (t) => t.recurrence ?? "" },
    { header: "Source", value: (t) => t.source },
    { header: "Status", value: (t) => t.status },
    { header: "Detail", value: (t) => t.detail },
  ];
  if (format === "csv") {
    await recordExportAudit(auditContext);
    return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="tasks.csv"', "cache-control": "private, no-store" } });
  }
  const buffer = await toXlsx("Tasks", columns, rows);
  await recordExportAudit(auditContext);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="tasks.xlsx"', "cache-control": "private, no-store" } });
}
