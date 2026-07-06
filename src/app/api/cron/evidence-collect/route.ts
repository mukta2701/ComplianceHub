import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveEvidenceProvider } from "@/features/integrations/application/evidence-registry";
import { toEvidenceRow } from "@/features/integrations/domain/evidence-collection";
import type { EvidenceProviderKind } from "@/features/integrations/domain/evidence-provider";

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function collect(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  // Active sources across every org — collection is a global sweep, tenant-scoped
  // per row by each source's organisation_id (mirrors integrations-sync).
  const { data: sources, error } = await supabase.from("evidence_sources")
    .select("id,organisation_id,provider,config,access_token,connected_by")
    .is("revoked_at", null);
  if (error) throw error;
  let collected = 0;
  let refreshed = 0;
  let failed = 0;
  for (const source of sources ?? []) {
    // One provider (or one org's mis-config) must not starve the rest of the
    // sweep — isolate each source, count failures, and keep going.
    try {
      const provider = resolveEvidenceProvider(source.provider as EvidenceProviderKind);
      const items = await provider.collect({
        id: source.id,
        provider: source.provider as EvidenceProviderKind,
        config: (source.config ?? {}) as Record<string, unknown>,
        accessToken: source.access_token ?? "",
      });
      for (const item of items) {
        const row = toEvidenceRow(item, { organisationId: source.organisation_id, sourceId: source.id });
        // Dedup by the Stage-1 partial unique index (source_id, external_ref).
        // Evidence rows are immutable except for status (DB trigger), so a
        // re-collect of an already-stored item is a no-op refresh rather than a
        // rewrite: look it up first, insert only when absent. This keeps the
        // sweep idempotent — re-running never duplicates a collected item.
        const { data: existing, error: lookupError } = await supabase.from("evidence")
          .select("id")
          .eq("source_id", source.id)
          .eq("external_ref", row.external_ref)
          .eq("organisation_id", source.organisation_id)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) { refreshed += 1; continue; }
        const { error: insertError } = await supabase.from("evidence").insert({
          ...row,
          // The source's connector is recorded as the evidence author.
          created_by: source.connected_by,
        });
        if (insertError) throw insertError;
        collected += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return NextResponse.json({ collected, refreshed, failed });
}

export async function GET(request: Request) { return collect(request); }
export async function POST(request: Request) { return collect(request); }
