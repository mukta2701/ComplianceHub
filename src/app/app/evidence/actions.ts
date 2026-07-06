"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ALLOWED_EVIDENCE_MIME_TYPES, MAX_EVIDENCE_FILE_BYTES, evidenceInputSchema, persistEvidenceWithCompensation } from "@/features/evidence/application/evidence";
import { deriveEvidenceStatus } from "@/features/evidence/domain/evidence";

export async function createEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`evidence:${user.id}`, { limit: 20, windowMs: 60_000 });
  const parsed = evidenceInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  let storagePath: string | null = null;
  if (parsed.kind === "file") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) redirect("/app/evidence/new?message=Choose%20a%20file%20to%20upload.");
    if (file.size > MAX_EVIDENCE_FILE_BYTES) redirect("/app/evidence/new?message=Files%20must%20be%2025%20MB%20or%20smaller.");
    if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) redirect("/app/evidence/new?message=That%20file%20type%20is%20not%20supported.");
    storagePath = `${organisation.id}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\-]+/g, "_").slice(-120)}`;
    const { error: uploadError } = await supabase.storage.from("evidence").upload(storagePath, file, { contentType: file.type });
    if (uploadError) redirect("/app/evidence/new?message=Could%20not%20upload%20the%20file.");
  }
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    organisation_id: organisation.id, title: parsed.title, kind: parsed.kind, storage_path: storagePath,
    url: parsed.kind === "link" ? parsed.url : null, description: parsed.description, owner_id: parsed.ownerId,
    collected_on: parsed.collectedOn ?? today, valid_until: parsed.validUntil, review_interval: parsed.reviewInterval,
    status: deriveEvidenceStatus(parsed.validUntil, today), replaces_evidence_id: parsed.replacesEvidenceId,
  };
  await persistEvidenceWithCompensation({ ...payload, storagePath }, {
    createRecord: async (record) => {
      const { data, error } = await supabase.rpc("create_evidence_record", { payload: record });
      if (error) throw error; return data as string;
    },
    removeUpload: async (path) => {
      const { error } = await createSupabaseServiceClient().storage.from("evidence").remove([path]);
      if (error) throw new AggregateError([error], "Evidence save and upload compensation both failed");
    },
  });
  revalidatePath("/app/evidence"); redirect("/app/evidence");
}

export async function linkEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const evidenceId = String(formData.get("evidenceId"));
  const target = String(formData.get("target")); // "control:<id>" | "risk:<id>" | "task:<id>" | "policy:<id>"
  const [kind, id] = target.split(":");
  if (!id || !["control", "risk", "task", "policy"].includes(kind)) throw new Error("Invalid link target");
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: evidenceId,
    control_id: kind === "control" ? id : null, risk_id: kind === "risk" ? id : null,
    task_id: kind === "task" ? id : null, policy_id: kind === "policy" ? id : null,
    created_by: user.id,
  });
  if (error) throw new Error("Could not link evidence");
  revalidatePath("/app/evidence");
}

export async function unlinkEvidenceAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  await supabase.from("evidence_links").delete().eq("id", String(formData.get("linkId")));
  revalidatePath("/app/evidence");
}

export async function withdrawEvidenceAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const { error } = await supabase.from("evidence").update({ status: "withdrawn" }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not withdraw evidence");
  revalidatePath("/app/evidence");
}

export async function downloadEvidenceAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const { data: item } = await supabase.from("evidence").select("storage_path").eq("id", String(formData.get("id"))).single();
  if (!item?.storage_path) throw new Error("Evidence file not found");
  const { data, error } = await supabase.storage.from("evidence").createSignedUrl(item.storage_path, 60);
  if (error || !data) throw new Error("Could not create a download link");
  redirect(data.signedUrl);
}
