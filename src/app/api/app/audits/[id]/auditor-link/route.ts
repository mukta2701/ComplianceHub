import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAppContext } from "@/lib/app-context";
import { AUDITOR_LINK_FLASH_COOKIE } from "@/features/audits/application/auditor-token";

export async function GET(_request:Request,{ params }:{ params:Promise<{id:string}> }) {
  const { id } = await params;
  const { supabase,organisation,membership } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") return NextResponse.json({ link:null },{ status:403 });
  const { data:audit,error } = await supabase.from("audits").select("id").eq("id",id).eq("organisation_id",organisation.id).maybeSingle();
  if (error || !audit) return NextResponse.json({ link:null },{ status:404 });
  const jar = await cookies();
  const rawToken = jar.get(AUDITOR_LINK_FLASH_COOKIE)?.value ?? null;
  const response = NextResponse.json({ link:rawToken ? `/audit-view/${rawToken}` : null },{ headers:{ "Cache-Control":"no-store" } });
  response.cookies.set(AUDITOR_LINK_FLASH_COOKIE,"",{ httpOnly:true,secure:process.env.NODE_ENV === "production",sameSite:"lax",maxAge:0,path:`/api/app/audits/${id}/auditor-link` });
  return response;
}
