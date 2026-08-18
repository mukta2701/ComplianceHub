import { NextResponse } from "next/server";
import { requireAppContext } from "@/lib/app-context";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { protectExport, recordExportAudit } from "@/features/exports/export-audit";
import { SOA_STATUS_LABEL, type SoaStatus } from "@/features/soa/domain/soa";
import { one } from "@/lib/supabase/one";

type Row = { control_code: string; control_title: string; applicable: boolean; status: string; justification: string; evidence: string; owner_id: string | null };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format: "csv" | "xlsx" = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const requestedRegisterId = url.searchParams.get("registerId");
  const { supabase, organisation, user } = await requireAppContext();
  const auditContext = { organisationId: organisation.id, userId: user.id, resource: "soa" as const, format };
  await protectExport(auditContext);
  let registerId = requestedRegisterId;
  if (!registerId) {
    const { data: latest } = await supabase.from("soa_registers").select("id").eq("organisation_id", organisation.id).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest) return NextResponse.json({ error: "No SoA register found" }, { status: 404 });
    registerId = latest.id;
  }
  const { data: register } = await supabase.from("soa_registers").select("id").eq("id", registerId).eq("organisation_id", organisation.id).maybeSingle();
  if (!register) return NextResponse.json({ error: "No SoA register found" }, { status: 404 });
  // soa_items.owner_id references memberships(user_id) — not profiles directly —
  // so resolve display names through the memberships → profiles join, matching the review page.
  const [{ data }, { data: members }] = await Promise.all([
    supabase.from("soa_items").select("control_code,control_title,applicable,status,justification,evidence,owner_id").eq("soa_register_id", registerId).eq("organisation_id", organisation.id).order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
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
  if (format === "csv") {
    await recordExportAudit(auditContext);
    return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="statement-of-applicability.csv"', "cache-control": "private, no-store" } });
  }
  const buffer = await toXlsx("SoA", columns, rows);
  await recordExportAudit(auditContext);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="statement-of-applicability.xlsx"', "cache-control": "private, no-store" } });
}
