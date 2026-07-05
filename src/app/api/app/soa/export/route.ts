import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { SOA_STATUS_LABEL, type SoaStatus } from "@/features/soa/domain/soa";

type Row = { control_code: string; control_title: string; applicable: boolean; status: string; justification: string; evidence: string };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const requestedRegisterId = url.searchParams.get("registerId");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  let registerId = requestedRegisterId;
  if (!registerId) {
    const { data: latest } = await supabase.from("soa_registers").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest) return NextResponse.json({ error: "No SoA register found" }, { status: 404 });
    registerId = latest.id;
  }
  const { data } = await supabase.from("soa_items").select("control_code,control_title,applicable,status,justification,evidence").eq("soa_register_id", registerId).order("position");
  const rows = (data ?? []) as unknown as Row[];
  const columns: ExportColumn<Row>[] = [
    { header: "Control Number", value: (i) => i.control_code },
    { header: "Control Description", value: (i) => i.control_title },
    { header: "Is Control Applicable?", value: (i) => (i.applicable ? "Yes" : "No") },
    { header: "Justification for the Inclusion/Exclusion", value: (i) => i.justification },
    { header: "Implementation Status", value: (i) => SOA_STATUS_LABEL[i.status as SoaStatus] },
    { header: "Comments", value: (i) => i.evidence },
  ];
  if (format === "csv") return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="statement-of-applicability.csv"', "cache-control": "private, no-store" } });
  const buffer = await toXlsx("SoA", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="statement-of-applicability.xlsx"', "cache-control": "private, no-store" } });
}
