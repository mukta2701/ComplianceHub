import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveTicketProvider } from "@/features/integrations/application/registry";
import { isTerminalTicketStatus, isTicketSyncDue } from "@/features/integrations/domain/mapping";
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
    .select("id,organisation_id,task_id,connection_id,provider,external_id,last_synced_at,integration_connections(config,access_token,revoked_at)");
  if (error) throw error;
  let synced = 0;
  let failed = 0;
  let tasksClosed = 0;
  for (const ticket of tickets ?? []) {
    if (!isTicketSyncDue({ lastSyncedAt: ticket.last_synced_at }, nowIso)) continue;
    const conn = Array.isArray(ticket.integration_connections) ? ticket.integration_connections[0] : ticket.integration_connections;
    if (!conn || conn.revoked_at) continue;
    // One provider error must not starve the rest of the sweep across other orgs:
    // isolate each ticket, count failures, and keep going.
    try {
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
      // Two-way sync: when the tracker ticket reaches a terminal "done" state,
      // close the linked ComplianceHub task. The `.in("status", …)` filter makes
      // this an atomic no-op unless the task is still open/in_progress — so we
      // never reopen a done task nor touch a cancelled one, and a re-run of the
      // cron on an already-closed task changes nothing (idempotent).
      if (isTerminalTicketStatus(fetched.status)) {
        const { data: closed, error: closeError } = await supabase.from("tasks")
          .update({ status: "done", updated_at: nowIso })
          .eq("id", ticket.task_id).eq("organisation_id", ticket.organisation_id)
          .in("status", ["open", "in_progress"]).select("id");
        if (closeError) throw closeError;
        tasksClosed += closed?.length ?? 0;
      }
    } catch {
      failed += 1;
    }
  }
  return NextResponse.json({ synced, failed, tasksClosed });
}

export async function GET(request: Request) { return sync(request); }
export async function POST(request: Request) { return sync(request); }
