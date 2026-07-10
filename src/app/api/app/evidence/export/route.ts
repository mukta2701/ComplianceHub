import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { one } from "@/lib/supabase/one";

type Row = { title: string; kind: string; status: string; collected_on: string; valid_until: string | null; profiles: { display_name: string } | { display_name: string }[] | null };

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data } = await supabase.from("evidence").select("id,title,kind,status,collected_on,valid_until,profiles:owner_id(display_name)").order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];
  const columns: ExportColumn<Row>[] = [
    { header: "Title", value: (e) => e.title },
    { header: "Kind", value: (e) => e.kind },
    { header: "Status", value: (e) => e.status },
    { header: "Collected on", value: (e) => e.collected_on },
    { header: "Valid until", value: (e) => e.valid_until ?? "" },
    { header: "Owner", value: (e) => one(e.profiles)?.display_name ?? "" },
  ];
  if (format === "csv") return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="evidence.csv"', "cache-control": "private, no-store" } });
  const buffer = await toXlsx("Evidence", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="evidence.xlsx"', "cache-control": "private, no-store" } });
}
