import { NextResponse } from "next/server";
import { requireAppContext } from "@/lib/app-context";
import { calculateRiskScore, RISK_STATUS_LABEL, type RiskStatus } from "@/features/risks/domain/risks";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { protectExport, recordExportAudit } from "@/features/exports/export-audit";
import { one } from "@/lib/supabase/one";

type Row = { reference: string; title: string; description: string; likelihood: number; impact: number; treatment_plan: string; status: string; review_date: string | null; risk_categories: { name: string } | { name: string }[] | null; profiles: { display_name: string } | { display_name: string }[] | null };

export async function GET(request: Request) {
  const format: "csv" | "xlsx" = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const { supabase, organisation, user } = await requireAppContext();
  const auditContext = { organisationId: organisation.id, userId: user.id, resource: "risks" as const, format };
  await protectExport(auditContext);
  const { data } = await supabase.from("risks").select("reference,title,description,likelihood,impact,treatment_plan,status,review_date,risk_categories(name),profiles:owner_id(display_name)").eq("organisation_id", organisation.id).order("reference");
  const rows = (data ?? []) as unknown as Row[];
  const columns: ExportColumn<Row>[] = [
    { header: "Risk ID", value: (r) => r.reference },
    { header: "Risk Description", value: (r) => r.description || r.title },
    { header: "Risk Category", value: (r) => one(r.risk_categories)?.name ?? "" },
    { header: "Likelihood", value: (r) => r.likelihood },
    { header: "Impact", value: (r) => r.impact },
    { header: "Risk Rating", value: (r) => calculateRiskScore(r.likelihood, r.impact) },
    { header: "Mitigation Measures", value: (r) => r.treatment_plan },
    { header: "Risk Owner", value: (r) => one(r.profiles)?.display_name ?? "" },
    { header: "Status", value: (r) => RISK_STATUS_LABEL[r.status as RiskStatus] },
    { header: "Review Date", value: (r) => r.review_date ?? "" },
  ];
  if (format === "csv") {
    await recordExportAudit(auditContext);
    return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="risk-register.csv"', "cache-control": "private, no-store" } });
  }
  const buffer = await toXlsx("Risk register", columns, rows);
  await recordExportAudit(auditContext);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="risk-register.xlsx"', "cache-control": "private, no-store" } });
}
