"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { mintAuditorToken, AUDITOR_LINK_FLASH_COOKIE } from "@/features/audits/application/auditor-token";

function requireAuditorAccessOperator(membership: { role:string }) {
  if (membership.role !== "owner" && membership.role !== "admin") throw new Error("Only workspace operators can manage auditor access");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function mintAuditorTokenAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  requireAuditorAccessOperator(membership);
  await enforceRateLimit(`auditor-token:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  const auditId = String(formData.get("auditId"));
  if (!UUID.test(auditId)) throw new Error("Invalid audit");
  const scope = String(formData.get("scope") || "audit");
  if (scope !== "audit" && scope !== "org") throw new Error("Invalid auditor link scope");
  const { data:audit,error:auditError } = await supabase.from("audits").select("id,framework").eq("id",auditId).eq("organisation_id",organisation.id).maybeSingle();
  if (auditError || !audit) throw new Error("Could not find the audit");
  const rawDays = Number(formData.get("expiresInDays"));
  const days = Number.isFinite(rawDays) ? Math.min(90, Math.max(1, rawDays)) : 14;
  // CSPRNG raw token; ONLY its sha256 hex hash is stored (matches the RPC lookup).
  const { rawToken, tokenHash, expiresAt } = mintAuditorToken({ expiresInDays: days });
  const { error } = await supabase.from("auditor_access_tokens").insert({
    organisation_id: organisation.id, token_hash: tokenHash, label: String(formData.get("label") || "External auditor").slice(0, 160),
    audit_id: scope === "audit" ? auditId : null, framework:scope === "audit" ? audit.framework : "Workspace readiness", expires_at: expiresAt, created_by: user.id,
  });
  if (error) throw new Error("Could not create the auditor link");
  revalidatePath(`/app/audits/${auditId}`);
  // The raw token is surfaced to the owner ONCE via a short-lived, httpOnly
  // flash cookie — NEVER the redirect URL, so it never lands in server access
  // logs, browser history, or Referer headers. It is rendered a single time
  // (Step 3) and is never stored server-side and never re-derivable from the
  // persisted hash.
  const jar = await cookies();
  jar.set(AUDITOR_LINK_FLASH_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60,
    path: `/api/app/audits/${auditId}/auditor-link`,
  });
  redirect(`/app/audits/${auditId}`);
}

export async function revokeAuditorTokenAction(formData: FormData) {
  const { supabase, organisation, membership } = await requireAppContext();
  requireAuditorAccessOperator(membership);
  const auditId = String(formData.get("auditId"));
  if (!UUID.test(auditId)) throw new Error("Invalid audit");
  const { data, error } = await supabase.from("auditor_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id"))).eq("organisation_id", organisation.id).or(`audit_id.eq.${auditId},audit_id.is.null`).select("id").maybeSingle();
  if (error || !data) throw new Error("Could not revoke the auditor link");
  revalidatePath(`/app/audits/${auditId}`);
}
