"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { mintAuditorToken } from "@/features/audits/application/auditor-token";

export async function mintAuditorTokenAction(formData: FormData) {
  // Owner-only at the data layer: auditor_access_tokens' RLS insert policy
  // requires is_organisation_owner + created_by = auth.uid(); requireAppContext
  // yields the RLS-scoped (never service-role) client.
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`auditor-token:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  const auditId = String(formData.get("auditId"));
  const scope = String(formData.get("scope") || "org"); // 'org' | 'audit'
  const days = Math.min(90, Math.max(1, Number(formData.get("expiresInDays") || 14)));
  // CSPRNG raw token; ONLY its sha256 hex hash is stored (matches the RPC lookup).
  const { rawToken, tokenHash, expiresAt } = mintAuditorToken({ expiresInDays: days });
  const { error } = await supabase.from("auditor_access_tokens").insert({
    organisation_id: organisation.id, token_hash: tokenHash, label: String(formData.get("label") || "External auditor").slice(0, 160),
    audit_id: scope === "audit" ? auditId : null, expires_at: expiresAt, created_by: user.id,
  });
  if (error) throw new Error("Could not create the auditor link");
  revalidatePath(`/app/audits/${auditId}`);
  // The raw token is surfaced to the owner ONCE via the redirect's ?link= param
  // and rendered a single time (Step 3). It is never stored and never
  // re-derivable from the persisted hash.
  redirect(`/app/audits/${auditId}?link=${encodeURIComponent(rawToken)}`);
}

export async function revokeAuditorTokenAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const auditId = String(formData.get("auditId"));
  const { error } = await supabase.from("auditor_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not revoke the auditor link");
  revalidatePath(`/app/audits/${auditId}`);
}
