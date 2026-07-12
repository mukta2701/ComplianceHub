"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { encryptSecret } from "@/lib/security/secrets";
import { connectionInputSchema } from "@/features/integrations/application/connection";
import { evidenceSourceInputSchema } from "@/features/integrations/application/evidence-source";

export async function addConnectionAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can add integrations");
  await enforceRateLimit(`connection:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = connectionInputSchema.parse(Object.fromEntries(formData));
  const config = parsed.provider === "jira"
    ? { baseUrl: parsed.baseUrl, projectKey: parsed.projectKey }
    : { owner: parsed.owner, repo: parsed.repo };
  const { error } = await supabase.from("integration_connections").insert({
    organisation_id: organisation.id, provider: parsed.provider, label: parsed.label || parsed.provider,
    config, access_token: encryptSecret(parsed.accessToken || null), connected_by: user.id,
  });
  if (error) throw new Error("Could not add the connection");
  revalidatePath("/app/integrations");
}

export async function revokeConnectionAction(formData: FormData) {
  const { supabase, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can revoke integrations");
  const { error } = await supabase.from("integration_connections").update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not revoke the connection");
  revalidatePath("/app/integrations");
}

export async function addEvidenceSourceAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can add evidence sources");
  await enforceRateLimit(`evidence-source:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = evidenceSourceInputSchema.parse(Object.fromEntries(formData));
  const config = parsed.provider === "google_workspace"
    ? { domain: parsed.domain }
    : parsed.provider === "github"
      ? { owner: parsed.owner, repo: parsed.repo }
      : { account: parsed.account, region: parsed.region };
  const { error } = await supabase.from("evidence_sources").insert({
    organisation_id: organisation.id, provider: parsed.provider, label: parsed.label || parsed.provider,
    config, access_token: encryptSecret(parsed.accessToken || null), connected_by: user.id,
  });
  if (error) throw new Error("Could not add the evidence source");
  revalidatePath("/app/integrations");
}

export async function revokeEvidenceSourceAction(formData: FormData) {
  const { supabase, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can revoke evidence sources");
  const { error } = await supabase.from("evidence_sources").update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not revoke the evidence source");
  revalidatePath("/app/integrations");
}
