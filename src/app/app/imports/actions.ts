"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { parseWorkbook } from "@/features/imports/parse";
import { coerceAndValidate, suggestMapping, type ColumnMapping } from "@/features/imports/mapping";
import { ADAPTERS, type ImportModule } from "@/features/imports/adapters";
import { riskInputSchema } from "@/features/risks/application/risk";
import { assetInputSchema } from "@/features/assets/application/asset";
import { soaItemReviewSchema } from "@/features/soa/application/review";

export type AnalyseResult = { headers: string[]; rows: string[][]; suggestion: Record<string, string> } | { error: string };
export type ImportRunResult = { committed: boolean; total: number; valid: number; invalid: number; imported: number; updated: number; skipped: number; rowErrors: { row: number; errors: string[] }[]; notes: string[] };

const MODULES = new Set<ImportModule>(["risk", "soa", "asset"]);
// Shared ceiling between the analyse preview and the write path — keeps dry-run/commit CPU and insert-loop cost bounded.
export const MAX_IMPORT_ROWS = 500;

export async function analyseImportAction(formData: FormData): Promise<AnalyseResult> {
  await requireAppContext(); // auth gate; parsing needs no org data
  const moduleName = String(formData.get("module")) as ImportModule;
  if (!MODULES.has(moduleName)) return { error: "Unknown import type." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > 5_000_000) return { error: "Files must be 5 MB or smaller." };
  const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  const adapter = ADAPTERS[moduleName];
  try {
    const { headers, rows } = await parseWorkbook(await file.arrayBuffer(), format, adapter.fields.map((f) => f.label));
    if (!headers.length) return { error: "Could not find a header row in that file." };
    const suggestion = suggestMapping(headers, adapter.fields);
    const cleaned: Record<string, string> = {};
    for (const [header, key] of Object.entries(suggestion)) cleaned[header] = key ?? "";
    return { headers, rows: rows.slice(0, MAX_IMPORT_ROWS), suggestion: cleaned };
  } catch {
    return { error: "That file could not be read. Export an XLSX or CSV and try again." };
  }
}

// Case-insensitive name -> id resolver for the per-org category tables; creates a missing category.
// Explicitly scoped to organisationId (not just RLS) so a caller who belongs to several orgs never
// resolves a name against a sibling org's rows.
async function categoryResolver(supabase: SupabaseClient, table: "risk_categories" | "asset_categories", organisationId: string) {
  const { data } = await supabase.from(table).select("id,name,position").eq("organisation_id", organisationId);
  const byName = new Map<string, string>();
  let maxPos = -1;
  for (const c of data ?? []) { byName.set(String(c.name).toLowerCase(), String(c.id)); maxPos = Math.max(maxPos, Number(c.position)); }
  return async (name: string): Promise<string | null> => {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    const existing = byName.get(key);
    if (existing) return existing;
    const { data: created } = await supabase.from(table).insert({ organisation_id: organisationId, name: name.trim(), position: ++maxPos }).select("id").single();
    if (created?.id) { byName.set(key, created.id); return created.id; }
    return null;
  };
}

// Membership rows are RLS-readable across every org the caller belongs to, so without an explicit
// organisation_id filter a display_name could resolve to a member of a sibling org. Scope it to the
// active org being imported into.
async function memberResolver(supabase: SupabaseClient, organisationId: string) {
  const { data } = await supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisationId);
  const byName = new Map<string, string>();
  for (const m of data ?? []) { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; if (p?.display_name) byName.set(String(p.display_name).toLowerCase(), String(m.user_id)); }
  return (name: string | null): string | null => (name ? byName.get(name.trim().toLowerCase()) ?? null : null);
}

// Resolves the SoA register + its control_code -> item id map. Read-only, so it's safe to call from
// both the dry-run preview and the real commit (Fix 4: keeps the preview's updated/skipped counts honest).
async function loadSoaRegister(supabase: SupabaseClient, registerId: string | undefined): Promise<{ registerId: string | null; byCode: Map<string, string> }> {
  let id = registerId;
  if (!id) {
    const { data: latest } = await supabase.from("soa_registers").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    id = latest?.id;
  }
  if (!id) return { registerId: null, byCode: new Map() };
  const { data: items } = await supabase.from("soa_items").select("id,control_code").eq("soa_register_id", id);
  const byCode = new Map<string, string>();
  for (const it of items ?? []) byCode.set(String(it.control_code).toLowerCase(), String(it.id));
  return { registerId: id, byCode };
}

function zodMessage(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export async function runImportAction(input: { module: ImportModule; headers: string[]; rows: string[][]; mapping: Record<string, string>; commit: boolean; registerId?: string }): Promise<ImportRunResult> {
  const { supabase, user, organisation } = await requireAppContext();
  if (!MODULES.has(input.module)) return emptyResult(input.commit);
  // Fix 1: analyseImportAction only ever hands back MAX_IMPORT_ROWS rows, so a legitimate client never
  // exceeds the ceiling — but this action trusts its input directly, so a caller could otherwise post an
  // unbounded array (unbounded CPU on dry-run, unbounded insert loop on commit). Hard-cap defensively.
  const rows = input.rows.length > MAX_IMPORT_ROWS ? input.rows.slice(0, MAX_IMPORT_ROWS) : input.rows;
  if (input.commit) await enforceRateLimit(`import:${user.id}`, { limit: 10, windowMs: 60_000 });
  const adapter = ADAPTERS[input.module];
  const mapping: ColumnMapping = {};
  for (const [header, key] of Object.entries(input.mapping)) mapping[header] = key || null;
  const results = coerceAndValidate(input.headers, rows, mapping, adapter.fields, adapter.rowSchema);

  const rowErrors: { row: number; errors: string[] }[] = [];
  const notes: string[] = [];
  if (rows.length < input.rows.length) notes.push(`Import is limited to ${MAX_IMPORT_ROWS} rows per file; ${input.rows.length} rows were provided.`);
  let imported = 0, updated = 0, skipped = 0;
  results.forEach((r, i) => { if (!r.ok) rowErrors.push({ row: i + 1, errors: r.errors }); });
  const valid = results.filter((r) => r.ok).length;
  const result: ImportRunResult = { committed: input.commit, total: results.length, valid, invalid: results.length - valid, imported: 0, updated: 0, skipped: 0, rowErrors, notes };
  if (!input.commit) {
    if (input.module === "soa") {
      // Fix 4: preview the real control_code match against the selected register instead of assuming every valid row updates.
      const { registerId, byCode } = await loadSoaRegister(supabase, input.registerId);
      if (!registerId) { notes.push("No SoA register found to update."); return result; }
      let previewUpdated = 0, previewSkipped = 0;
      for (const r of results) {
        if (!r.ok) continue;
        const v = r.values as Record<string, string | number | boolean | null>;
        if (byCode.has(String(v.controlCode).toLowerCase())) previewUpdated++;
        else { previewSkipped++; notes.push(`Control ${v.controlCode} is not in this register — skipped.`); }
      }
      result.updated = previewUpdated;
      result.skipped = previewSkipped;
      return result;
    }
    result.imported = valid;
    return result;
  }

  if (input.module === "risk") {
    const resolveCategory = await categoryResolver(supabase, "risk_categories", organisation.id);
    const resolveMember = await memberResolver(supabase, organisation.id);
    const { count } = await supabase.from("risks").select("id", { count: "exact", head: true });
    let n = count ?? 0;
    for (const r of results) {
      if (!r.ok) continue;
      const v = r.values as Record<string, string | number | boolean | null>;
      const categoryId = await resolveCategory(String(v.categoryName));
      if (!categoryId) { skipped++; notes.push(`Could not resolve category "${v.categoryName}".`); continue; }
      const reference = (v.reference as string) || `R-${String(++n).padStart(3, "0")}`;
      // Fix 3: safeParse so one malformed row can't throw and abort the whole batch mid-commit.
      const parseResult = riskInputSchema.safeParse({
        organisationId: organisation.id, reference, title: String(v.description).slice(0, 200), description: String(v.description),
        categoryId, ownerId: resolveMember(v.ownerName as string | null), likelihood: v.likelihood, impact: v.impact,
        treatment: "mitigate", treatmentPlan: (v.treatmentPlan as string) ?? "", residualLikelihood: v.likelihood, residualImpact: v.impact,
        reviewDate: (v.reviewDate as string) ?? "", status: (v.status as string) ?? "open", evidence: "",
      });
      if (!parseResult.success) { skipped++; notes.push(`Row ${reference}: ${zodMessage(parseResult.error)}`); continue; }
      const parsed = parseResult.data;
      const { error } = await supabase.from("risks").insert({ organisation_id: organisation.id, reference: parsed.reference, title: parsed.title, description: parsed.description, category_id: parsed.categoryId, owner_id: parsed.ownerId || null, likelihood: parsed.likelihood, impact: parsed.impact, treatment: parsed.treatment, treatment_plan: parsed.treatmentPlan, residual_likelihood: parsed.residualLikelihood, residual_impact: parsed.residualImpact, review_date: parsed.reviewDate || null, status: parsed.status, evidence: parsed.evidence, created_by: user.id });
      if (error) { skipped++; notes.push(`Row ${reference}: ${error.message}`); } else imported++;
    }
    revalidatePath("/app/risks");
  } else if (input.module === "asset") {
    const resolveCategory = await categoryResolver(supabase, "asset_categories", organisation.id);
    const resolveMember = await memberResolver(supabase, organisation.id);
    const { count } = await supabase.from("assets").select("id", { count: "exact", head: true });
    let n = count ?? 0;
    for (const r of results) {
      if (!r.ok) continue;
      const v = r.values as Record<string, string | number | boolean | null>;
      const reference = (v.reference as string) || `AST-${String(++n).padStart(3, "0")}`;
      const parseResult = assetInputSchema.safeParse({
        organisationId: organisation.id, reference, description: String(v.description), ownerLocation: (v.ownerLocation as string) ?? "",
        ownerId: resolveMember(v.ownerLocation as string | null) ?? "", classification: v.classification, valueCriticality: v.valueCriticality,
        categoryId: (v.categoryName ? await resolveCategory(String(v.categoryName)) : null) ?? "", securityControls: (v.securityControls as string) ?? "",
        lifespan: (v.lifespan as string) ?? "", lastUpdated: (v.lastUpdated as string) ?? "", remarks: (v.remarks as string) ?? "",
      });
      if (!parseResult.success) { skipped++; notes.push(`Row ${reference}: ${zodMessage(parseResult.error)}`); continue; }
      const parsed = parseResult.data;
      const { error } = await supabase.from("assets").insert({ organisation_id: organisation.id, reference: parsed.reference, description: parsed.description, owner_location: parsed.ownerLocation, owner_id: parsed.ownerId, classification: parsed.classification, value_criticality: parsed.valueCriticality, category_id: parsed.categoryId, security_controls: parsed.securityControls, lifespan: parsed.lifespan, last_updated: parsed.lastUpdated, remarks: parsed.remarks, created_by: user.id });
      if (error) { skipped++; notes.push(`Row ${reference}: ${error.message}`); } else imported++;
    }
    revalidatePath("/app/assets");
  } else { // soa — UPDATE matched control_code rows in the selected register
    const { registerId, byCode } = await loadSoaRegister(supabase, input.registerId);
    if (!registerId) { notes.push("No SoA register found to update."); return result; }
    const resolveMember = await memberResolver(supabase, organisation.id);
    for (const r of results) {
      if (!r.ok) continue;
      const v = r.values as Record<string, string | number | boolean | null>;
      const itemId = byCode.get(String(v.controlCode).toLowerCase());
      if (!itemId) { skipped++; notes.push(`Control ${v.controlCode} is not in this register — skipped.`); continue; }
      const parseResult = soaItemReviewSchema.safeParse({ itemId, status: v.status, applicable: v.applicable, justification: v.justification, evidence: (v.comments as string) ?? "" });
      if (!parseResult.success) { skipped++; notes.push(`Control ${v.controlCode}: ${zodMessage(parseResult.error)}`); continue; }
      const parsed = parseResult.data;
      const { error } = await supabase.from("soa_items").update({ status: parsed.status, applicable: parsed.applicable, justification: parsed.justification, evidence: parsed.evidence, owner_id: resolveMember(v.ownerName as string | null) }).eq("id", parsed.itemId);
      if (error) { skipped++; notes.push(`Control ${v.controlCode}: ${error.message}`); } else updated++;
    }
    revalidatePath("/app/soa");
  }
  return { ...result, imported, updated, skipped, notes };
}

function emptyResult(commit: boolean): ImportRunResult { return { committed: commit, total: 0, valid: 0, invalid: 0, imported: 0, updated: 0, skipped: 0, rowErrors: [], notes: [] }; }
