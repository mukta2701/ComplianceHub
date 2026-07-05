import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { SOA_STATUS_LABEL, type SoaStatus } from "@/features/soa/domain/soa";

type Row = { control_code: string; control_title: string; applicable: boolean; status: string; justification: string; evidence: string; owner_id: string | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

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
  // soa_items.owner_id references memberships(user_id) — not profiles directly —
  // so resolve display names through the memberships → profiles join, matching the review page.
  const [{ data }, { data: members }] = await Promise.all([
    supabase.from("soa_items").select("control_code,control_title,applicable,status,justification,evidence,owner_id").eq("soa_register_id", registerId).order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const ownerName = new Map<string, string>();
  for (const m of members ?? []) { const p = one(m.profiles); if (p?.display_name) ownerName.set(m.user_id, p.display_name); }
  const columns: ExportColumn<Row>[] = [
    { header: "Control Number", value: (i) => i.control_code },
    { header: "Control Description", value: (i) => i.control_title },
    { header: "Is Control Applicable?", value: (i) => (i.applicable ? "Yes" : "No") },
    { header: "Justification for the Inclusion/Exclusion", value: (i) => i.justification },
    { header: "Implementation Status", value: (i) => SOA_STATUS_LABEL[i.status as SoaStatus] },
    { header: "Owner", value: (i) => (i.owner_id ? ownerName.get(i.owner_id) ?? "" : "") },
    { header: "Comments", value: (i) => i.evidence },
  ];
  if (format === "csv") return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="statement-of-applicability.csv"', "cache-control": "private, no-store" } });
  const buffer = await toXlsx("SoA", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="statement-of-applicability.xlsx"', "cache-control": "private, no-store" } });
}
