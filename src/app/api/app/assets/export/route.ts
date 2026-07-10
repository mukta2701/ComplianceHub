import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import { one } from "@/lib/supabase/one";

type Row = { reference: string; description: string; owner_location: string; classification: string; value_criticality: string; security_controls: string; lifespan: string; last_updated: string | null; remarks: string; asset_categories: { name: string } | { name: string }[] | null };

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data } = await supabase.from("assets").select("reference,description,owner_location,classification,value_criticality,security_controls,lifespan,last_updated,remarks,asset_categories(name)").order("reference");
  const rows = (data ?? []) as unknown as Row[];
  const columns: ExportColumn<Row>[] = [
    { header: "Asset Reference", value: (a) => a.reference },
    { header: "Asset Description", value: (a) => a.description },
    { header: "Category", value: (a) => one(a.asset_categories)?.name ?? "" },
    { header: "Owner & Location", value: (a) => a.owner_location },
    { header: "Classification", value: (a) => ASSET_CLASSIFICATION_LABEL[a.classification as AssetClassification] },
    { header: "Value (Criticality)", value: (a) => ASSET_VALUE_LABEL[a.value_criticality as AssetValue] },
    { header: "Security Controls", value: (a) => a.security_controls },
    { header: "Asset Lifespan", value: (a) => a.lifespan },
    { header: "Last Updated", value: (a) => a.last_updated ?? "" },
    { header: "Remarks", value: (a) => a.remarks },
  ];
  if (format === "csv") return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="asset-inventory.csv"', "cache-control": "private, no-store" } });
  const buffer = await toXlsx("Asset inventory", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="asset-inventory.xlsx"', "cache-control": "private, no-store" } });
}
