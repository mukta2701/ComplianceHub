import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveTicketProvider } from "@/features/integrations/application/registry";
import { isTicketSyncDue } from "@/features/integrations/domain/mapping";
import type { IntegrationProvider } from "@/features/integrations/domain/provider";

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sync(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const { data: tickets, error } = await supabase.from("task_tickets")
    .select("id,organisation_id,connection_id,provider,external_id,last_synced_at,integration_connections(config,access_token,revoked_at)");
  if (error) throw error;
  let synced = 0;
  for (const ticket of tickets ?? []) {
    if (!isTicketSyncDue({ lastSyncedAt: ticket.last_synced_at }, nowIso)) continue;
    const conn = Array.isArray(ticket.integration_connections) ? ticket.integration_connections[0] : ticket.integration_connections;
    if (!conn || conn.revoked_at) continue;
    const provider = resolveTicketProvider(ticket.provider as IntegrationProvider);
    const fetched = await provider.fetchTicket(
      { id: ticket.connection_id, provider: ticket.provider as IntegrationProvider, config: (conn.config ?? {}) as Record<string, unknown>, accessToken: conn.access_token ?? "" },
      ticket.external_id,
    );
    // Tenant-scoped update: filtered by this row's organisation_id.
    const { error: updateError } = await supabase.from("task_tickets").update({
      external_status: fetched.status, external_assignee: fetched.assignee, external_url: fetched.url,
      last_synced_at: nowIso, updated_at: nowIso,
    }).eq("id", ticket.id).eq("organisation_id", ticket.organisation_id);
    if (updateError) throw updateError;
    synced += 1;
  }
  return NextResponse.json({ synced });
}

export async function GET(request: Request) { return sync(request); }
export async function POST(request: Request) { return sync(request); }
