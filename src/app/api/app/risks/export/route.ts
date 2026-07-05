import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateRiskScore } from "@/features/risks/domain/risks";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";

type Row = { reference: string; title: string; description: string; likelihood: number; impact: number; treatment_plan: string; status: string; review_date: string | null; risk_categories: { name: string } | { name: string }[] | null; profiles: { display_name: string } | { display_name: string }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data } = await supabase.from("risks").select("reference,title,description,likelihood,impact,treatment_plan,status,review_date,risk_categories(name),profiles:owner_id(display_name)").order("reference");
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
    { header: "Status", value: (r) => r.status },
    { header: "Review Date", value: (r) => r.review_date ?? "" },
  ];
  if (format === "csv") return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="risk-register.csv"', "cache-control": "private, no-store" } });
  const buffer = await toXlsx("Risk register", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="risk-register.xlsx"', "cache-control": "private, no-store" } });
}
