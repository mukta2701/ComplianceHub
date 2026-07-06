import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { CHECKLIST_RESULT_LABEL, FINDING_SEVERITY_LABEL, FINDING_STATUS_LABEL, type ChecklistResult, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";

type PackRow = { section: string; ref: string; item: string; result: string; detail: string };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data: audit } = await supabase.from("audits").select("reference,title").eq("id", id).maybeSingle();
  if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [{ data: items }, { data: findings }] = await Promise.all([
    supabase.from("audit_checklist_items").select("area,clause_reference,checklist_item,compliant,evidence_note,findings").eq("audit_id", id).order("position"),
    supabase.from("audit_findings").select("summary,severity,status,corrective_action").eq("audit_id", id).order("created_at"),
  ]);
  const rows: PackRow[] = [
    ...(items ?? []).map((i) => ({ section: "Checklist", ref: `${i.area} ${i.clause_reference}`.trim(), item: i.checklist_item, result: CHECKLIST_RESULT_LABEL[i.compliant as ChecklistResult], detail: [i.evidence_note, i.findings].filter(Boolean).join(" — ") })),
    ...(findings ?? []).map((f) => ({ section: "Finding", ref: FINDING_SEVERITY_LABEL[f.severity as FindingSeverity], item: f.summary, result: FINDING_STATUS_LABEL[f.status as FindingStatus], detail: f.corrective_action })),
  ];
  const columns: ExportColumn<PackRow>[] = [
    { header: "Section", value: (r) => r.section }, { header: "Reference", value: (r) => r.ref },
    { header: "Item", value: (r) => r.item }, { header: "Result", value: (r) => r.result }, { header: "Detail", value: (r) => r.detail },
  ];
  const filename = `audit-pack-${audit.reference}`;
  if (format === "csv") {
    return new NextResponse(toCsv(columns, rows), { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.csv"`, "cache-control": "private, no-store" } });
  }
  const buffer = await toXlsx("Audit pack", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${filename}.xlsx"`, "cache-control": "private, no-store" } });
}
