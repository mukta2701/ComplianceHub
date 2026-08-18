import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/observability/logger";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export type ExportResource = "assessment" | "assets" | "audits" | "evidence" | "risks" | "soa" | "soa_snapshot" | "tasks" | "readiness";
export type ExportFormat = "csv" | "xlsx" | "pdf" | "docx";

export type ExportAuditContext = {
  organisationId: string;
  userId: string;
  resource: ExportResource;
  format: ExportFormat;
};

export async function protectExport({ organisationId, userId }: ExportAuditContext) {
  await enforceRateLimit(`export:${organisationId}:${userId}`, { limit: 30, windowMs: 60_000 });
}

export async function recordExportAudit({ organisationId, userId, resource, format }: ExportAuditContext) {
  try {
    const { error } = await createSupabaseServiceClient().from("audit_events").insert({
      organisation_id: organisationId,
      actor_id: userId,
      action: "export",
      entity_type: "export",
      entity_id: `export:${resource}:${format}`,
      metadata: { resource, format },
    });
    if (error) throw error;
  } catch (error) {
    await logError("action", "export audit event unavailable", error, { organisationId, resource, format });
  }
}
